import { Types } from "mongoose";
import { InternalOrder, IInternalOrder, IOrderLine } from "../models/internalOrder.model";
import { Branch } from "../models/branch.model";
import { Ingredient } from "../models/ingredient.model";
import { getSettings } from "../models/settings.model";
import { nextNumber } from "../models/counter.model";
import { raiseAlert } from "../models/alert.model";
import { badRequest, conflict, notFound } from "../errors/httpError";
import { round3 } from "../utils/numbers";
import { suggestOrder } from "./forecast.service";
import { moveStock } from "./inventory.service";
import { audit } from "./audit.service";
import { AuthPayload } from "../middlewares/auth.middleware";

export async function productionBranch() {
  const b = await Branch.findOne({ type: "produccion", active: true });
  if (!b) throw conflict("No hay un centro de producción configurado (Locales → tipo producción)");
  return b;
}

/** Crea el borrador del pedido de un local con la sugerencia del sistema ya cargada. */
export async function draftOrder(auth: AuthPayload, branchId: string, deliveryDate: string) {
  const branch = await Branch.findById(branchId);
  if (!branch || branch.type !== "local") throw badRequest("Local inválido");
  const existing = await InternalOrder.findOne({ branch: branch._id, deliveryDate, status: { $ne: "anulado" } });
  if (existing) return existing;
  const s = await suggestOrder(branch._id, deliveryDate);
  const items: IOrderLine[] = s.lines.map((l) => ({ ingredient: new Types.ObjectId(l.ingredient), ingredientName: l.ingredientName, unit: l.unit, stock: l.stock, expected: l.expected, suggested: l.suggested, requested: l.suggested, approved: 0, dispatched: 0, received: 0, inflated: false, justification: "" }));
  const order = await InternalOrder.create({ number: await nextNumber("PED"), branch: branch._id, branchName: branch.name, deliveryDate, status: "borrador", items, createdBy: auth.name });
  return order;
}

function recomputeInflated(order: IInternalOrder, thresholdPct: number) {
  let count = 0;
  for (const it of order.items) {
    const limit = it.suggested * (1 + thresholdPct / 100);
    // Si la sugerencia es 0 y pide algo, también se marca (no hay historial que lo respalde).
    it.inflated = it.requested > 0 && (it.suggested === 0 ? it.requested > it.expected * (1 + thresholdPct / 100) : it.requested > limit + 0.0001);
    if (it.inflated) count++;
  }
  order.inflatedCount = count;
}

/** El local ajusta cantidades y envía. Lo que pase del umbral queda marcado como inflado (necesita justificación). */
export async function updateAndSend(auth: AuthPayload, id: string, body: { items?: { ingredient: string; requested: number; justification?: string }[]; notes?: string; send?: boolean }) {
  const order = await InternalOrder.findById(id);
  if (!order) throw notFound("Pedido no encontrado");
  if (!["borrador", "enviado"].includes(order.status)) throw conflict(`El pedido ya está ${order.status}`);
  const settings = await getSettings();
  if (body.items) {
    const byId = new Map(body.items.map((i) => [i.ingredient, i]));
    for (const it of order.items) {
      const u = byId.get(String(it.ingredient));
      if (u) {
        it.requested = round3(Math.max(0, Number(u.requested) || 0));
        if (u.justification !== undefined) it.justification = String(u.justification).trim();
      }
    }
    // Insumos agregados a mano que no estaban en la sugerencia
    for (const u of body.items) {
      if (order.items.some((it) => String(it.ingredient) === u.ingredient)) continue;
      const ing = await Ingredient.findById(u.ingredient);
      if (!ing || !(Number(u.requested) > 0)) continue;
      order.items.push({ ingredient: ing._id, ingredientName: ing.name, unit: ing.unit, stock: 0, expected: 0, suggested: 0, requested: round3(Number(u.requested)), approved: 0, dispatched: 0, received: 0, inflated: true, justification: String(u.justification ?? "").trim() });
    }
  }
  if (body.notes !== undefined) order.notes = String(body.notes);
  recomputeInflated(order, settings.inflatedThresholdPct);
  if (body.send) {
    const missing = order.items.filter((it) => it.inflated && !it.justification);
    if (missing.length) throw badRequest("Hay cantidades por encima de lo sugerido sin justificación", { ingredients: missing.map((m) => m.ingredientName) });
    order.items = order.items.filter((it) => it.requested > 0);
    if (!order.items.length) throw badRequest("El pedido está vacío");
    order.status = "enviado";
    order.sentAt = new Date();
    if (order.inflatedCount) {
      await raiseAlert({ type: "pedido_inflado", severity: "warning", title: `${order.branchName} pidió más de lo sugerido`, body: `${order.number}: ${order.inflatedCount} insumo(s) por encima del umbral (${settings.inflatedThresholdPct} %). Revisar antes de aprobar.`, branch: order.branch, branchName: order.branchName, audience: ["produccion", "gerencia"], refType: "InternalOrder", refId: order._id, key: `inflado:${order._id}` });
    }
  }
  await order.save();
  await audit(auth, body.send ? "enviar_pedido" : "editar_pedido", { type: "InternalOrder", id: order._id, label: order.number }, { inflated: order.inflatedCount });
  return order;
}

/** Producción aprueba (puede ajustar cantidades). */
export async function approveOrder(auth: AuthPayload, id: string, body: { items?: { ingredient: string; approved: number }[]; productionNote?: string }) {
  const order = await InternalOrder.findById(id);
  if (!order) throw notFound("Pedido no encontrado");
  if (order.status !== "enviado") throw conflict(`El pedido está ${order.status}, no se puede aprobar`);
  const byId = new Map((body.items ?? []).map((i) => [i.ingredient, i]));
  for (const it of order.items) {
    const u = byId.get(String(it.ingredient));
    it.approved = round3(u ? Math.max(0, Number(u.approved) || 0) : it.requested);
  }
  if (body.productionNote !== undefined) order.productionNote = String(body.productionNote);
  order.status = "aprobado";
  order.approvedBy = auth.name;
  order.approvedAt = new Date();
  await order.save();
  await audit(auth, "aprobar_pedido", { type: "InternalOrder", id: order._id, label: order.number });
  return order;
}

/** Producción despacha: sale del centro de producción. */
export async function dispatchOrder(auth: AuthPayload, id: string, body: { items?: { ingredient: string; dispatched: number }[] }) {
  const order = await InternalOrder.findById(id);
  if (!order) throw notFound("Pedido no encontrado");
  if (order.status !== "aprobado") throw conflict(`El pedido está ${order.status}, no se puede despachar`);
  const prod = await productionBranch();
  const byId = new Map((body.items ?? []).map((i) => [i.ingredient, i]));
  for (const it of order.items) {
    const u = byId.get(String(it.ingredient));
    it.dispatched = round3(u ? Math.max(0, Number(u.dispatched) || 0) : it.approved);
    if (it.dispatched) await moveStock({ branch: prod._id, ingredient: it.ingredient, type: "despacho", qty: -it.dispatched, refType: "InternalOrder", refId: order._id, note: `Despacho ${order.number} → ${order.branchName}`, userName: auth.name });
  }
  order.status = "despachado";
  order.dispatchedAt = new Date();
  await order.save();
  await audit(auth, "despachar_pedido", { type: "InternalOrder", id: order._id, label: order.number });
  return order;
}

/** El local recibe: entra a su inventario lo que realmente llegó. */
export async function receiveOrder(auth: AuthPayload, id: string, body: { items?: { ingredient: string; received: number }[]; note?: string }) {
  const order = await InternalOrder.findById(id);
  if (!order) throw notFound("Pedido no encontrado");
  if (order.status !== "despachado") throw conflict(`El pedido está ${order.status}, no se puede recibir`);
  const byId = new Map((body.items ?? []).map((i) => [i.ingredient, i]));
  for (const it of order.items) {
    const u = byId.get(String(it.ingredient));
    it.received = round3(u ? Math.max(0, Number(u.received) || 0) : it.dispatched);
    if (it.received) await moveStock({ branch: order.branch, ingredient: it.ingredient, type: "recepcion", qty: it.received, refType: "InternalOrder", refId: order._id, note: `Recepción ${order.number}`, userName: auth.name });
  }
  order.status = "recibido";
  order.receivedBy = auth.name;
  order.receivedAt = new Date();
  if (body.note) order.notes = `${order.notes}\n[recepción] ${body.note}`.trim();
  await order.save();
  await audit(auth, "recibir_pedido", { type: "InternalOrder", id: order._id, label: order.number });
  return order;
}

export async function cancelOrder(auth: AuthPayload, id: string, note: string) {
  const order = await InternalOrder.findById(id);
  if (!order) throw notFound("Pedido no encontrado");
  if (["despachado", "recibido"].includes(order.status)) throw conflict("Un pedido despachado no se anula: regístralo como recibido y ajusta inventario");
  if (!note) throw badRequest("Indica el motivo");
  order.status = "anulado";
  order.notes = `${order.notes}\n[anulado] ${note}`.trim();
  await order.save();
  await audit(auth, "anular_pedido", { type: "InternalOrder", id: order._id, label: order.number }, { note });
  return order;
}

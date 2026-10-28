import { Types } from "mongoose";
import { ProductionPlan, IPlanLine, IRawNeed } from "../models/productionPlan.model";
import { InternalOrder } from "../models/internalOrder.model";
import { Ingredient } from "../models/ingredient.model";
import { Branch } from "../models/branch.model";
import { getSettings } from "../models/settings.model";
import { nextNumber } from "../models/counter.model";
import { raiseAlert } from "../models/alert.model";
import { badRequest, conflict, notFound } from "../errors/httpError";
import { round3 } from "../utils/numbers";
import { moveStock, stockMap } from "./inventory.service";
import { productionBranch } from "./order.service";
import { audit } from "./audit.service";
import { AuthPayload } from "../middlewares/auth.middleware";

/**
 * Arma (o rearma, si sigue en borrador) el plan de producción de una fecha:
 * consolida los pedidos aprobados/enviados de todos los locales para esa fecha, los compara con la
 * existencia del centro de producción y calcula cuánto producir y qué materia prima hace falta en bodega.
 */
export async function buildPlan(auth: AuthPayload, date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("Fecha inválida");
  let plan = await ProductionPlan.findOne({ date });
  if (plan && plan.status !== "borrador") throw conflict(`El plan del ${date} ya está ${plan.status}`);
  const settings = await getSettings();
  const prod = await productionBranch();
  const bodega = (await Branch.findOne({ type: "bodega", active: true })) ?? prod;
  const orders = await InternalOrder.find({ deliveryDate: date, status: { $in: ["enviado", "aprobado"] } });
  const required = new Map<string, number>();
  for (const o of orders) for (const it of o.items) {
    const qty = o.status === "aprobado" ? it.approved : it.requested;
    required.set(String(it.ingredient), round3((required.get(String(it.ingredient)) ?? 0) + qty));
  }
  const ingredients = await Ingredient.find({ _id: { $in: [...required.keys()].map((k) => new Types.ObjectId(k)) } });
  const byId = new Map(ingredients.map((i) => [String(i._id), i]));
  const prodStock = await stockMap(prod._id);
  const factor = 1 + settings.safetyStockPct / 100;
  const items: IPlanLine[] = [];
  const rawNeed = new Map<string, number>();
  for (const [id, req] of required) {
    const ing = byId.get(id);
    if (!ing) continue;
    const stock = prodStock.get(id) ?? 0;
    const toProduce = ing.producedInHouse ? round3(Math.max(0, req * factor - stock)) : 0;
    items.push({ ingredient: ing._id, ingredientName: ing.name, unit: ing.unit, required: req, stock: round3(stock), toProduce, produced: 0 });
    if (ing.producedInHouse) for (const line of ing.recipe) rawNeed.set(String(line.ingredient), round3((rawNeed.get(String(line.ingredient)) ?? 0) + line.qty * toProduce));
    else rawNeed.set(id, round3((rawNeed.get(id) ?? 0) + Math.max(0, req - stock))); // insumo que solo se reparte: debe salir de bodega
  }
  const rawIds = [...rawNeed.keys()].map((k) => new Types.ObjectId(k));
  const rawIngs = await Ingredient.find({ _id: { $in: rawIds } });
  const bodegaStock = await stockMap(bodega._id);
  const rawNeeds: IRawNeed[] = rawIngs.map((ing) => {
    const needed = rawNeed.get(String(ing._id)) ?? 0;
    const stock = bodegaStock.get(String(ing._id)) ?? 0;
    return { ingredient: ing._id, ingredientName: ing.name, unit: ing.unit, needed, stock: round3(stock), shortage: round3(Math.max(0, needed - stock)) };
  }).filter((r) => r.needed > 0).sort((a, b) => b.shortage - a.shortage);
  if (!plan) plan = new ProductionPlan({ number: await nextNumber("PLAN"), date, createdBy: auth.name });
  plan.orders = orders.map((o) => o._id);
  plan.items = items.sort((a, b) => b.toProduce - a.toProduce);
  plan.rawNeeds = rawNeeds;
  await plan.save();
  for (const r of rawNeeds.filter((r) => r.shortage > 0)) {
    await raiseAlert({ type: "materia_prima_faltante", severity: "critical", title: `Falta ${r.ingredientName} para producir el ${date}`, body: `Se necesitan ${r.needed} ${r.unit} y bodega tiene ${r.stock}. Faltan ${r.shortage}.`, audience: ["compras", "bodega", "produccion", "gerencia"], refType: "ProductionPlan", refId: plan._id, key: `mp:${date}:${r.ingredient}` });
  }
  await audit(auth, "armar_plan", { type: "ProductionPlan", id: plan._id, label: plan.number }, { orders: orders.length });
  return plan;
}

/** Registra lo producido: entra el preparado al centro de producción y se consume su receta de bodega/producción. */
export async function registerProduction(auth: AuthPayload, planId: string, body: { ingredient: string; qty: number; note?: string }) {
  const plan = await ProductionPlan.findById(planId);
  if (!plan) throw notFound("Plan no encontrado");
  if (plan.status === "cerrado") throw conflict("El plan ya está cerrado");
  const qty = round3(Number(body.qty) || 0);
  if (qty <= 0) throw badRequest("Cantidad inválida");
  const ing = await Ingredient.findById(body.ingredient);
  if (!ing) throw notFound("Preparado no encontrado");
  const prod = await productionBranch();
  const bodega = (await Branch.findOne({ type: "bodega", active: true })) ?? prod;
  // consume materia prima de bodega (si no hay en bodega, se toma del centro de producción)
  for (const line of ing.recipe) {
    const need = round3(line.qty * qty);
    const bStock = (await stockMap(bodega._id)).get(String(line.ingredient)) ?? 0;
    const fromBodega = Math.min(need, Math.max(0, bStock));
    if (fromBodega > 0) await moveStock({ branch: bodega._id, ingredient: line.ingredient, type: "consumo_produccion", qty: -fromBodega, refType: "ProductionPlan", refId: plan._id, note: `Producción de ${ing.name}`, userName: auth.name });
    if (need - fromBodega > 0.0001) await moveStock({ branch: prod._id, ingredient: line.ingredient, type: "consumo_produccion", qty: -(need - fromBodega), refType: "ProductionPlan", refId: plan._id, note: `Producción de ${ing.name}`, userName: auth.name });
  }
  await moveStock({ branch: prod._id, ingredient: ing._id, type: "produccion", qty, refType: "ProductionPlan", refId: plan._id, note: body.note ?? `Producido ${plan.date}`, userName: auth.name });
  const line = plan.items.find((i) => String(i.ingredient) === String(ing._id));
  if (line) line.produced = round3(line.produced + qty);
  else plan.items.push({ ingredient: ing._id, ingredientName: ing.name, unit: ing.unit, required: 0, stock: 0, toProduce: 0, produced: qty });
  if (plan.status === "borrador") plan.status = "en_proceso";
  await plan.save();
  await audit(auth, "registrar_produccion", { type: "ProductionPlan", id: plan._id, label: plan.number }, { ingredient: ing.name, qty });
  return plan;
}

export async function closePlan(auth: AuthPayload, planId: string, notes: string) {
  const plan = await ProductionPlan.findById(planId);
  if (!plan) throw notFound("Plan no encontrado");
  plan.status = "cerrado";
  plan.closedAt = new Date();
  if (notes) plan.notes = notes;
  await plan.save();
  await audit(auth, "cerrar_plan", { type: "ProductionPlan", id: plan._id, label: plan.number });
  return plan;
}

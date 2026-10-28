import { Types } from "mongoose";
import { CustomerOrder, ICustomerOrderItem, PAYMENT_METHODS, CustomerOrderStatus } from "../models/customerOrder.model";
import { Branch } from "../models/branch.model";
import { Product } from "../models/product.model";
import { nextNumber } from "../models/counter.model";
import { badRequest, conflict, notFound } from "../errors/httpError";
import { round2 } from "../utils/numbers";
import { env } from "../config/env";
import { payphoneConfigured, preparePayment, confirmPayment } from "./payphone.service";
import { audit } from "./audit.service";
import { AuthPayload } from "../middlewares/auth.middleware";

export interface CheckoutInput {
  branch: string;
  type: "retiro" | "domicilio";
  customer: { name: string; phone: string; email?: string };
  address?: { text?: string; reference?: string; lat?: number | null; lng?: number | null };
  items: { product: string; qty: number; options?: { name: string; choice: string }[]; notes?: string }[];
  payment: string;
  notes?: string;
  scheduledFor?: string;
  channel?: "web" | "whatsapp" | "agente" | "telefono";
}

function code(): string {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

/** Crea el pedido de la tienda: valida local, productos y opciones; calcula totales en el servidor. */
export async function createCustomerOrder(input: CheckoutInput): Promise<{ order: InstanceType<typeof CustomerOrder>; paymentUrl: string | null }> {
  const branch = await Branch.findById(input.branch);
  if (!branch || !branch.active || branch.type !== "local") throw badRequest("Local inválido");
  if (!["retiro", "domicilio"].includes(input.type)) throw badRequest("Tipo de entrega inválido");
  if (input.type === "retiro" && !branch.pickupEnabled) throw badRequest(`${branch.name} no tiene retiro en local activo`);
  if (input.type === "domicilio" && !branch.deliveryEnabled) throw badRequest(`${branch.name} no hace envíos a domicilio`);
  if (input.type === "domicilio" && !input.address?.text?.trim()) throw badRequest("Indica la dirección de entrega");
  let distanceKm: number | null = null;
  if (input.type === "domicilio" && branch.lat != null && branch.lng != null && typeof input.address?.lat === "number" && typeof input.address?.lng === "number") {
    const R = 6371, toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(input.address.lat - branch.lat), dLng = toRad(input.address.lng - branch.lng);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(branch.lat)) * Math.cos(toRad(input.address.lat)) * Math.sin(dLng / 2) ** 2;
    distanceKm = round2(2 * R * Math.asin(Math.sqrt(a)));
    if (branch.deliveryRadiusKm > 0 && distanceKm > branch.deliveryRadiusKm) throw badRequest(`Esa dirección está a ${distanceKm} km de ${branch.name}; el envío llega hasta ${branch.deliveryRadiusKm} km. Prueba con otro local.`, { distanceKm });
  }
  const name = String(input.customer?.name ?? "").trim();
  const phone = String(input.customer?.phone ?? "").replace(/[^\d+]/g, "");
  if (!name || phone.length < 9) throw badRequest("Nombre y teléfono válidos son obligatorios");
  if (!Array.isArray(input.items) || !input.items.length) throw badRequest("El carrito está vacío");
  const method = String(input.payment) as (typeof PAYMENT_METHODS)[number];
  if (!PAYMENT_METHODS.includes(method)) throw badRequest("Forma de pago inválida");
  if (method === "payphone" && !payphoneConfigured()) throw badRequest("El pago con tarjeta aún no está disponible");
  if (method === "local" && input.type !== "retiro") throw badRequest("Pagar en el local solo aplica a retiro");
  if (method === "efectivo" && input.type !== "domicilio") throw badRequest("Pago en efectivo al recibir solo aplica a domicilio");
  const products = await Product.find({ _id: { $in: input.items.map((i) => new Types.ObjectId(i.product)) }, active: true, online: true });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const items: ICustomerOrderItem[] = [];
  for (const it of input.items) {
    const p = byId.get(it.product);
    if (!p) throw badRequest("Un producto del carrito ya no está disponible");
    if (p.excludedBranches.some((b) => String(b) === String(branch._id))) throw badRequest(`${p.name} no se vende en ${branch.name}`);
    const qty = Math.max(1, Math.min(50, Math.round(Number(it.qty) || 1)));
    const options: { name: string; choice: string; price: number }[] = [];
    for (const opt of p.options) {
      const chosen = (it.options ?? []).filter((o) => o.name === opt.name);
      if (opt.required && !chosen.length) throw badRequest(`${p.name}: elige ${opt.name}`);
      if (chosen.length > Math.max(1, opt.max)) throw badRequest(`${p.name}: máximo ${opt.max} en ${opt.name}`);
      for (const c of chosen) {
        const ch = opt.choices.find((x) => x.label === c.choice);
        if (!ch) throw badRequest(`${p.name}: opción "${c.choice}" inválida`);
        options.push({ name: opt.name, choice: ch.label, price: ch.price });
      }
    }
    const unitPrice = round2(p.price + options.reduce((a, o) => a + o.price, 0));
    items.push({ product: p._id, name: p.name, qty, unitPrice, options, notes: String(it.notes ?? "").slice(0, 200), lineTotal: round2(unitPrice * qty) });
  }
  const subtotal = round2(items.reduce((a, i) => a + i.lineTotal, 0));
  if (branch.minOrder > 0 && subtotal < branch.minOrder) throw badRequest(`El pedido mínimo en ${branch.name} es $${branch.minOrder}`);
  const deliveryFee = input.type === "domicilio" ? round2(branch.deliveryFee) : 0;
  const total = round2(subtotal + deliveryFee);
  const order = await CustomerOrder.create({
    number: await nextNumber("TIENDA"), trackingCode: code(), branch: branch._id, branchName: branch.name, type: input.type, channel: input.channel ?? "web",
    customer: { name, phone, email: String(input.customer.email ?? "").trim() }, address: { text: String(input.address?.text ?? "").trim(), reference: String(input.address?.reference ?? "").trim(), lat: input.address?.lat ?? null, lng: input.address?.lng ?? null },
    items, subtotal, deliveryFee, total, payment: { method, status: "pendiente", reference: "", payphoneId: "", paidAt: null }, status: "nuevo", notes: String(input.notes ?? "").slice(0, 500), scheduledFor: String(input.scheduledFor ?? ""), estimatedMinutes: branch.prepMinutes + (input.type === "domicilio" ? 20 + Math.round((distanceKm ?? 4) * 3) : 0),
    timeline: [{ status: "nuevo", at: new Date(), by: "cliente", note: "" }],
  });
  let paymentUrl: string | null = null;
  if (method === "payphone") {
    const r = await preparePayment({ amountUsd: total, clientTransactionId: order.number, reference: `La Pata Gorda ${order.number}`, responseUrl: `${env.SHOP_URL}/tienda/pago?order=${order.trackingCode}`, email: order.customer.email || undefined, phone: order.customer.phone });
    order.payment.payphoneId = r.paymentId; await order.save();
    paymentUrl = r.url;
  }
  return { order, paymentUrl };
}

/** Retorno de Payphone: confirma la transacción y marca el pedido como pagado. */
export async function confirmPayphone(trackingCode: string, id: string, clientTxId: string) {
  const order = await CustomerOrder.findOne({ trackingCode });
  if (!order) throw notFound("Pedido no encontrado");
  if (order.payment.status === "pagado") return order;
  const r = await confirmPayment(id, clientTxId);
  order.payment.status = r.ok ? "pagado" : "fallido";
  order.payment.reference = r.transactionId;
  order.payment.paidAt = r.ok ? new Date() : null;
  if (!r.ok && order.status === "nuevo") { order.status = "cancelado"; order.cancelReason = "Pago con tarjeta no aprobado"; order.timeline.push({ status: "cancelado", at: new Date(), by: "payphone", note: `statusCode ${r.statusCode}` }); }
  await order.save();
  return order;
}

const NEXT: Record<CustomerOrderStatus, CustomerOrderStatus[]> = { nuevo: ["aceptado", "cancelado"], aceptado: ["en_preparacion", "listo", "cancelado"], en_preparacion: ["listo", "cancelado"], listo: ["en_camino", "entregado", "cancelado"], en_camino: ["entregado", "cancelado"], entregado: [], cancelado: [] };

/** El local avanza el pedido en la pantalla de pedidos. */
export async function setOrderStatus(auth: AuthPayload, id: string, status: CustomerOrderStatus, note = "", extra: { estimatedMinutes?: number; enteredInPos?: boolean; paid?: boolean } = {}) {
  const order = await CustomerOrder.findById(id);
  if (!order) throw notFound("Pedido no encontrado");
  if (status && status !== order.status) {
    if (!NEXT[order.status].includes(status)) throw conflict(`Un pedido ${order.status} no puede pasar a ${status}`);
    if (status === "cancelado" && !note) throw badRequest("Indica el motivo de la cancelación");
    if (status === "en_camino" && order.type === "retiro") throw badRequest("Un pedido para retiro no va en camino");
    order.status = status;
    if (status === "cancelado") order.cancelReason = note;
    order.timeline.push({ status, at: new Date(), by: auth.name, note });
  }
  if (extra.estimatedMinutes !== undefined) order.estimatedMinutes = Math.max(5, Number(extra.estimatedMinutes) || order.estimatedMinutes);
  if (extra.enteredInPos !== undefined) order.enteredInPos = Boolean(extra.enteredInPos);
  if (extra.paid) { order.payment.status = "pagado"; order.payment.paidAt = new Date(); if (!order.payment.reference) order.payment.reference = `cobrado por ${auth.name}`; }
  await order.save();
  await audit(auth, "pedido_tienda", { type: "CustomerOrder", id: order._id, label: order.number }, { status: order.status, note });
  return order;
}

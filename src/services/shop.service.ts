import { Types } from "mongoose";
import { CustomerOrder, ICustomerOrderItem, PAYMENT_METHODS, CustomerOrderStatus } from "../models/customerOrder.model";
import { Branch } from "../models/branch.model";
import { Product } from "../models/product.model";
import { nextNumber } from "../models/counter.model";
import { badRequest, conflict, notFound } from "../errors/httpError";
import { round2 } from "../utils/numbers";
import { env } from "../config/env";
import { amounts, confirmPayment, PayphoneFlow, payphoneConfigured, preparePayment, toE164 } from "./payphone.service";
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
  /** "box": la tienda muestra la Cajita de Pagos. Sin indicar: link de pago por redirección. */
  paymentFlow?: PayphoneFlow;
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
  const flow: PayphoneFlow = input.paymentFlow === "box" ? "box" : "button";
  if (method === "payphone" && (!payphoneConfigured() || !branch.payphoneEnabled)) throw badRequest("El pago con tarjeta aún no está disponible");
  if (method === "payphone" && flow === "box" && !String(input.customer.email ?? "").trim()) throw badRequest("Para pagar con tarjeta necesitamos tu correo");
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
    items, subtotal, deliveryFee, total, payment: { method, status: "pendiente", reference: "", payphoneId: "", paidAt: null, flow: method === "payphone" ? flow : "", attempts: 0, clientTxId: "", authorizationCode: "", card: "" }, status: method === "payphone" ? "por_pagar" : "nuevo", notes: String(input.notes ?? "").slice(0, 500), scheduledFor: String(input.scheduledFor ?? ""), estimatedMinutes: branch.prepMinutes + (input.type === "domicilio" ? 20 + Math.round((distanceKm ?? 4) * 3) : 0),
    timeline: [{ status: method === "payphone" ? "por_pagar" : "nuevo", at: new Date(), by: "cliente", note: "" }],
  });
  let paymentUrl: string | null = null;
  if (method === "payphone" && flow === "button") {
    const clientTransactionId = nextClientTx(order);
    const r = await preparePayment({ amountUsd: total, clientTransactionId, reference: `La Pata Gorda ${order.number}`, responseUrl: `${env.SHOP_URL}/tienda/pago?order=${order.trackingCode}`, storeId: branch.payphoneStoreId || env.PAYPHONE_STORE_ID, email: order.customer.email || undefined, phone: order.customer.phone });
    order.payment.payphoneId = r.paymentId; await order.save();
    paymentUrl = r.url;
  }
  return { order, paymentUrl };
}

/** Payphone exige un id único por intento: código de seguimiento + número de intento. */
function nextClientTx(order: InstanceType<typeof CustomerOrder>): string {
  order.payment.attempts = (order.payment.attempts ?? 0) + 1;
  order.payment.clientTxId = `${order.trackingCode}-${order.payment.attempts}`;
  return order.payment.clientTxId;
}

/** Datos de la Cajita de Pagos para un pedido por pagar. Cada llamada es un intento nuevo. */
export async function startBoxPayment(trackingCode: string) {
  const order = await CustomerOrder.findOne({ trackingCode });
  if (!order) throw notFound("Pedido no encontrado");
  if (order.payment.method !== "payphone") throw badRequest("Este pedido no se paga con tarjeta");
  if (order.payment.status === "pagado") return { order, box: null };
  if (order.status !== "por_pagar") throw conflict("Este pedido ya no se puede pagar");
  if (!payphoneConfigured()) throw badRequest("El pago con tarjeta aún no está disponible");
  const branch = await Branch.findById(order.branch);
  const clientTransactionId = nextClientTx(order);
  order.payment.flow = "box";
  order.payment.status = "pendiente";
  await order.save();
  const { service: _service, tip: _tip, ...money } = amounts(order.total);
  return { order, box: { token: env.PAYPHONE_TOKEN, storeId: branch?.payphoneStoreId || env.PAYPHONE_STORE_ID, clientTransactionId, ...money, reference: `La Pata Gorda ${order.number}`, email: order.customer.email, phoneNumber: toE164(order.customer.phone) } };
}

/**
 * Regreso de Payphone. El pedido sale del id de transacción, y solo cuenta como pagado si Payphone
 * lo aprueba, por ese mismo id y por el monto exacto del pedido. Si no se aprueba sigue "por_pagar"
 * para que el cliente pueda reintentar o cambiar de forma de pago.
 */
export async function confirmPayphone(id: string, clientTxId: string, trackingCode?: string) {
  const code = (trackingCode || clientTxId.split("-")[0] || "").toUpperCase();
  const order = await CustomerOrder.findOne({ trackingCode: code });
  if (!order) throw notFound("Pedido no encontrado");
  if (order.payment.method !== "payphone") throw badRequest("Este pedido no se paga con tarjeta");
  if (order.payment.status === "pagado") return order;
  if (!clientTxId.startsWith(`${order.trackingCode}-`)) throw badRequest("La transacción no corresponde a este pedido");
  const r = await confirmPayment(order.payment.flow === "box" ? "box" : "button", Number(id), clientTxId);
  const expected = Math.round(order.total * 100);
  const genuine = r.ok && r.clientTransactionId === clientTxId && r.amount === expected;
  if (r.ok && !genuine) console.error(`[payphone] pago aprobado que no cuadra con ${order.number}: tx ${r.clientTransactionId}, monto ${r.amount}, esperado ${expected}`);
  order.payment.reference = r.transactionId;
  if (genuine) {
    order.payment.status = "pagado";
    order.payment.paidAt = new Date();
    order.payment.authorizationCode = r.authorizationCode;
    order.payment.card = [r.cardBrand, r.lastDigits].filter(Boolean).join(" ");
    order.timeline.push({ status: "pagado", at: new Date(), by: "payphone", note: "" });
    // Ya cobrado: entra a la pantalla de pedidos aunque el pedido hubiera caducado mientras pagaba.
    if (order.status === "por_pagar" || order.status === "cancelado") { order.status = "nuevo"; order.cancelReason = ""; order.timeline.push({ status: "nuevo", at: new Date(), by: "payphone", note: "" }); }
  } else {
    order.payment.status = "fallido";
    order.timeline.push({ status: "pago_rechazado", at: new Date(), by: "payphone", note: r.message || `statusCode ${r.statusCode}` });
  }
  await order.save();
  return order;
}

/** Tarjeta rechazada o sin tarjeta a mano: el pedido pasa a pagarse al recibir o en el local. */
export async function changeToOfflinePayment(trackingCode: string, payment: string) {
  const order = await CustomerOrder.findOne({ trackingCode });
  if (!order) throw notFound("Pedido no encontrado");
  if (order.status !== "por_pagar" || order.payment.status === "pagado") throw conflict("Este pedido ya no puede cambiar de forma de pago");
  const allowed = order.type === "retiro" ? "local" : "efectivo";
  if (payment !== allowed) throw badRequest(order.type === "retiro" ? "En retiro se paga en el local" : "A domicilio se paga en efectivo al recibir");
  order.payment.method = allowed;
  order.payment.status = "pendiente";
  order.status = "nuevo";
  order.timeline.push({ status: "nuevo", at: new Date(), by: "cliente", note: "Cambió a pago al recibir" });
  await order.save();
  return order;
}

/** Pedidos con tarjeta que nunca se pagaron: se cancelan al pasar una hora (el formulario dura 10 min). */
export async function expireUnpaidOrders(): Promise<number> {
  const stale = await CustomerOrder.find({ status: "por_pagar", createdAt: { $lt: new Date(Date.now() - 3600000) } });
  for (const o of stale) { o.status = "cancelado"; o.cancelReason = "Pago con tarjeta sin completar"; o.timeline.push({ status: "cancelado", at: new Date(), by: "sistema", note: o.cancelReason }); await o.save(); }
  return stale.length;
}

const NEXT: Record<CustomerOrderStatus, CustomerOrderStatus[]> = { por_pagar: ["nuevo", "cancelado"], nuevo: ["aceptado", "cancelado"], aceptado: ["en_preparacion", "listo", "cancelado"], en_preparacion: ["listo", "cancelado"], listo: ["en_camino", "entregado", "cancelado"], en_camino: ["entregado", "cancelado"], entregado: [], cancelado: [] };

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

import { Types } from "mongoose";
import { Branch } from "../models/branch.model";
import { Category, Product } from "../models/product.model";
import { CustomerOrder, CUSTOMER_ORDER_STATUSES, CustomerOrderStatus } from "../models/customerOrder.model";
import { Reservation, CHANNELS } from "../models/reservation.model";
import { getSettings } from "../models/settings.model";
import { nextNumber } from "../models/counter.model";
import { badRequest, notFound } from "../errors/httpError";
import { h, str } from "../utils/handler";
import { num } from "../utils/numbers";
import { pageQuery, paged } from "../utils/pagination";
import { ecuadorDateString } from "../utils/dates";
import { payphoneConfigured } from "../services/payphone.service";
import { env } from "../config/env";
import { createCustomerOrder, confirmPayphone, setOrderStatus } from "../services/shop.service";
import { assertBranchAccess } from "./catalog.controller";

const publicBranch = (b: InstanceType<typeof Branch>) => ({ id: b._id, code: b.code, name: b.name, city: b.city, address: b.address, phone: b.phone, hours: b.hours, pickupEnabled: b.pickupEnabled, deliveryEnabled: b.deliveryEnabled, deliveryFee: b.deliveryFee, minOrder: b.minOrder, prepMinutes: b.prepMinutes, whatsapp: b.whatsapp, mapsUrl: b.mapsUrl, lat: b.lat, lng: b.lng, deliveryRadiusKm: b.deliveryRadiusKm, capacity: b.capacity, privateTables: b.privateTables });

// ---------- Público (tienda) ----------
export const storefront = h(async (_req, res) => {
  const [branches, categories, products, settings] = await Promise.all([
    Branch.find({ type: "local", active: true }).sort({ order: 1 }),
    Category.find({ active: true }).sort({ order: 1, name: 1 }),
    Product.find({ active: true, online: true }).sort({ name: 1 }),
    getSettings(),
  ]);
  res.json({
    branches: branches.map(publicBranch),
    categories: categories.map((c) => ({ id: c._id, name: c.name, order: c.order })),
    products: products.map((p) => ({ id: p._id, code: p.code, name: p.name, category: p.category, description: p.description, price: p.price, image: p.image, featured: p.featured, options: p.options, excludedBranches: p.excludedBranches })),
    payments: { payphone: payphoneConfigured(), local: true, efectivo: true, transferencia: false },
    whatsapp: settings.whatsappNumber,
    mapsKey: env.GOOGLE_MAPS_API_KEY,
  });
});

export const checkout = h(async (req, res) => {
  const { order, paymentUrl } = await createCustomerOrder({ ...req.body, channel: req.body.channel && ["whatsapp", "agente", "telefono"].includes(req.body.channel) ? req.body.channel : "web" });
  res.status(201).json({ number: order.number, trackingCode: order.trackingCode, total: order.total, paymentUrl, status: order.status });
});

export const track = h(async (req, res) => {
  const order = await CustomerOrder.findOne({ trackingCode: String(req.params.code).toUpperCase() });
  if (!order) throw notFound("Pedido no encontrado");
  const o = order.toObject();
  res.json({ order: { number: o.number, trackingCode: o.trackingCode, branchName: o.branchName, type: o.type, customer: { name: o.customer.name }, address: o.address, items: o.items, subtotal: o.subtotal, deliveryFee: o.deliveryFee, total: o.total, payment: { method: o.payment.method, status: o.payment.status }, status: o.status, estimatedMinutes: o.estimatedMinutes, scheduledFor: o.scheduledFor, timeline: o.timeline, createdAt: o.createdAt, cancelReason: o.cancelReason } });
});

export const payphoneReturn = h(async (req, res) => {
  const { order: code, id, clientTransactionId } = req.body as { order?: string; id?: string; clientTransactionId?: string };
  if (!code || !id || !clientTransactionId) throw badRequest("Faltan datos del pago");
  const order = await confirmPayphone(String(code).toUpperCase(), String(id), String(clientTransactionId));
  res.json({ status: order.status, payment: order.payment.status, trackingCode: order.trackingCode });
});

/** Solicitud pública de reserva (web / agente). Mesas privadas o dentro de la hora quedan "pendiente" para confirmación. */
export const publicReservation = h(async (req, res) => {
  const { branch, date, time, name, phone, people, notes, privateTable, channel } = req.body;
  if (!branch || !date || !time || !name || !phone || !people) throw badRequest("Local, fecha, hora, nombre, teléfono y personas son obligatorios");
  const b = await Branch.findById(branch);
  if (!b || b.type !== "local" || !b.active) throw badRequest("Local inválido");
  const settings = await getSettings();
  const when = new Date(`${date}T${time}:00-05:00`).getTime();
  if (Number.isNaN(when) || when < Date.now() - 60000) throw badRequest("Fecha u hora inválida");
  const withinHour = when - Date.now() < 3600000;
  const wantsPrivate = Boolean(privateTable);
  // Cupo en la franja
  const docs = await Reservation.find({ branch: b._id, date, status: { $in: ["pendiente", "confirmada", "sentada"] } });
  const [hh, mm] = String(time).split(":").map(Number);
  const t = (hh ?? 0) * 60 + (mm ?? 0);
  const used = docs.filter((r) => { const [rh, rm] = r.time.split(":").map(Number); return Math.abs((rh ?? 0) * 60 + (rm ?? 0) - t) < settings.reservationSlotMin; }).reduce((a, r) => a + r.people, 0);
  if (b.capacity > 0 && used + num(people) > b.capacity) throw badRequest(`No hay cupo a esa hora en ${b.name}`, { free: Math.max(0, b.capacity - used) });
  const status = wantsPrivate || withinHour ? "pendiente" : "confirmada";
  const r = await Reservation.create({ number: await nextNumber("RES"), branch: b._id, branchName: b.name, date, time, name: str(name), phone: str(phone), people: num(people), status, channel: CHANNELS.includes(channel) ? channel : "web", notes: `${wantsPrivate ? `[privado: ${str(privateTable)}] ` : ""}${str(notes)}`.trim(), createdBy: "cliente" });
  res.status(201).json({ reservation: { number: r.number, status: r.status, branchName: r.branchName, date: r.date, time: r.time, people: r.people }, message: status === "confirmada" ? `Reserva confirmada en ${b.name} el ${date} a las ${time}.` : `Solicitud recibida. ${wantsPrivate ? "Las mesas privadas" : "Las reservas dentro de la próxima hora"} las confirma el administrador del local; te avisamos por WhatsApp.` });
});

// ---------- Pantalla de pedidos (local / atención) ----------
export const board = h(async (req, res) => {
  const branchId = req.query.branch ? String(req.query.branch) : req.auth!.role === "local" ? req.auth!.branch : null;
  const filter: Record<string, unknown> = {};
  if (branchId) { assertBranchAccess(req.auth, branchId); filter.branch = new Types.ObjectId(branchId); }
  const today = ecuadorDateString();
  const since = new Date(`${today}T00:00:00-05:00`);
  const [active, done] = await Promise.all([
    CustomerOrder.find({ ...filter, status: { $in: ["nuevo", "aceptado", "en_preparacion", "listo", "en_camino"] } }).sort({ createdAt: 1 }),
    CustomerOrder.find({ ...filter, status: { $in: ["entregado", "cancelado"] }, updatedAt: { $gte: since } }).sort({ updatedAt: -1 }).limit(50),
  ]);
  res.json({ active, done, newCount: active.filter((o) => o.status === "nuevo").length, lastId: active.length ? String(active[active.length - 1]!._id) : "" });
});

export const listCustomerOrders = h(async (req, res) => {
  const q = pageQuery(req, 50);
  const filter: Record<string, unknown> = {};
  const branchId = req.query.branch ? String(req.query.branch) : req.auth!.role === "local" ? req.auth!.branch : null;
  if (branchId) { assertBranchAccess(req.auth, branchId); filter.branch = new Types.ObjectId(branchId); }
  if (req.query.status) filter.status = { $in: String(req.query.status).split(",") };
  if (req.query.from || req.query.to) filter.createdAt = { ...(req.query.from ? { $gte: new Date(`${req.query.from}T00:00:00-05:00`) } : {}), ...(req.query.to ? { $lte: new Date(`${req.query.to}T23:59:59-05:00`) } : {}) };
  if (req.query.q) filter.$or = [{ number: { $regex: String(req.query.q), $options: "i" } }, { "customer.name": { $regex: String(req.query.q), $options: "i" } }, { "customer.phone": { $regex: String(req.query.q), $options: "i" } }];
  const [items, total] = await Promise.all([CustomerOrder.find(filter).sort({ createdAt: -1 }).skip(q.skip).limit(q.limit), CustomerOrder.countDocuments(filter)]);
  res.json(paged(items, total, q));
});

export const getCustomerOrder = h(async (req, res) => {
  const order = await CustomerOrder.findById(req.params.id);
  if (!order) throw notFound("Pedido no encontrado");
  assertBranchAccess(req.auth, String(order.branch));
  res.json({ order });
});

export const updateCustomerOrder = h(async (req, res) => {
  const order = await CustomerOrder.findById(req.params.id);
  if (!order) throw notFound("Pedido no encontrado");
  assertBranchAccess(req.auth, String(order.branch));
  const status = req.body.status as CustomerOrderStatus | undefined;
  if (status && !CUSTOMER_ORDER_STATUSES.includes(status)) throw badRequest("Estado inválido");
  res.json({ order: await setOrderStatus(req.auth!, req.params.id as string, status ?? order.status, str(req.body.note), { estimatedMinutes: req.body.estimatedMinutes, enteredInPos: req.body.enteredInPos, paid: Boolean(req.body.paid) }) });
});

/** Pedido tomado por teléfono/WhatsApp por una persona del equipo (misma validación que la tienda). */
export const staffOrder = h(async (req, res) => {
  const { order, paymentUrl } = await createCustomerOrder({ ...req.body, channel: req.body.channel ?? "whatsapp" });
  res.status(201).json({ order, paymentUrl });
});

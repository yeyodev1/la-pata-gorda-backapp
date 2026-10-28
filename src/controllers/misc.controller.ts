import { Types } from "mongoose";
import { Alert } from "../models/alert.model";
import { AuditEvent } from "../models/auditEvent.model";
import { Settings, getSettings } from "../models/settings.model";
import { Branch } from "../models/branch.model";
import { DailySales } from "../models/dailySales.model";
import { InternalOrder } from "../models/internalOrder.model";
import { Reservation } from "../models/reservation.model";
import { Conversation } from "../models/conversation.model";
import { Review } from "../models/review.model";
import { ProductionPlan } from "../models/productionPlan.model";
import { Purchase } from "../models/purchase.model";
import { CustomerOrder } from "../models/customerOrder.model";
import { isConnected } from "../config/mongo";
import { badRequest, notFound } from "../errors/httpError";
import { h, str } from "../utils/handler";
import { num, round2 } from "../utils/numbers";
import { pageQuery, paged } from "../utils/pagination";
import { ecuadorDateString, addDaysStr } from "../utils/dates";
import { audit } from "../services/audit.service";
import { salesReport, countDiffReport, orderBehaviorReport } from "../services/reports.service";
import { askAssistant, assistantConfigured, businessSnapshot } from "../services/assistant.service";
import { runDailyCron } from "../services/cron.service";
import { signUpload, mediaConfigured } from "../services/media.service";

export const health = h(async (_req, res) => { res.json({ ok: true, db: isConnected(), assistant: assistantConfigured(), media: mediaConfigured(), time: new Date().toISOString() }); });

// ---------- Panel ----------
export const dashboard = h(async (req, res) => {
  const today = ecuadorDateString();
  const tomorrow = addDaysStr(today, 1);
  const weekAgo = addDaysStr(today, -6);
  const mine = req.auth!.role === "local" && req.auth!.branch ? new Types.ObjectId(req.auth!.branch) : null;
  const branches = await Branch.find({ type: "local", active: true, ...(mine ? { _id: mine } : {}) }).sort({ order: 1 });
  const bIds = branches.map((b) => b._id);
  const timings: Record<string, number> = {}; const t0 = Date.now();
  const timed = async <T>(k: string, p: Promise<T>): Promise<T> => { const s = Date.now(); const r = await p; timings[k] = Date.now() - s; return r; };
  const shopToday = await timed("shopToday", CustomerOrder.find({ branch: { $in: bIds }, createdAt: { $gte: new Date(`${today}T00:00:00-05:00`) } }).lean());
  const [sales, orders, reservations, alerts, conversations, reviews, plan, purchases] = await Promise.all([
    timed("sales", DailySales.find({ branch: { $in: bIds }, date: { $gte: weekAgo, $lte: today } }, { branch: 1, date: 1, totalAmount: 1 }).lean()),
    timed("orders", InternalOrder.find({ branch: { $in: bIds }, deliveryDate: { $in: [today, tomorrow] }, status: { $ne: "anulado" } }, { branch: 1, deliveryDate: 1, status: 1, inflatedCount: 1 }).lean()),
    timed("reservations", Reservation.find({ branch: { $in: bIds }, date: today, status: { $in: ["pendiente", "confirmada", "sentada"] } }, { branch: 1, people: 1 }).lean()),
    timed("alerts", Alert.find({ status: "abierta", ...(mine ? { branch: mine } : {}) }).sort({ severity: -1, createdAt: -1 }).limit(10).lean()),
    mine ? Promise.resolve(0) : timed("conv", Conversation.countDocuments({ status: "abierta", unread: { $gt: 0 } })),
    mine ? Promise.resolve(0) : timed("reviews", Review.countDocuments({ status: "nueva" })),
    timed("plan", ProductionPlan.findOne({ date: tomorrow }, { number: 1, status: 1, items: 1, rawNeeds: 1 }).lean()),
    mine ? Promise.resolve(0) : timed("purchases", Purchase.countDocuments({ status: { $in: ["requerimiento", "pedida"] } })),
  ]);
  timings.total = Date.now() - t0;
  const perBranch = branches.map((b) => {
    const s = sales.filter((x) => String(x.branch) === String(b._id));
    const todayS = s.find((x) => x.date === today);
    const o = orders.filter((x) => String(x.branch) === String(b._id));
    return { id: b._id, name: b.name, city: b.city, today: todayS?.totalAmount ?? null, week: round2(s.reduce((a, x) => a + x.totalAmount, 0)), daysClosed: s.length, orderToday: o.find((x) => x.deliveryDate === today)?.status ?? null, orderTomorrow: o.find((x) => x.deliveryDate === tomorrow)?.status ?? null, inflated: o.reduce((a, x) => a + x.inflatedCount, 0), reservationsToday: reservations.filter((r) => String(r.branch) === String(b._id)).reduce((a, r) => a + r.people, 0) };
  });
  const byDay = Array.from({ length: 7 }, (_, i) => { const d = addDaysStr(weekAgo, i); return { date: d, amount: round2(sales.filter((s) => s.date === d).reduce((a, s) => a + s.totalAmount, 0)) }; });
  const shop = { orders: shopToday.length, amount: round2(shopToday.filter((o) => o.status !== "cancelado").reduce((a, o) => a + o.total, 0)), pending: shopToday.filter((o) => o.status === "nuevo").length, byBranch: Object.fromEntries(branches.map((b) => [String(b._id), shopToday.filter((o) => String(o.branch) === String(b._id) && o.status !== "cancelado").length])) };
  res.json({ today, tomorrow, timings, shop, totals: { today: round2(perBranch.reduce((a, b) => a + (b.today ?? 0), 0)), week: round2(perBranch.reduce((a, b) => a + b.week, 0)), reservationsToday: reservations.reduce((a, r) => a + r.people, 0), openAlerts: alerts.length, unreadConversations: conversations, pendingReviews: reviews, pendingOrders: orders.filter((o) => o.status === "enviado").length, openPurchases: purchases }, branches: perBranch, byDay, alerts, plan: plan ? { id: plan._id, number: plan.number, status: plan.status, items: plan.items.length, shortages: plan.rawNeeds.filter((r) => r.shortage > 0).length } : null });
});

// ---------- Alertas ----------
export const listAlerts = h(async (req, res) => {
  const q = pageQuery(req, 100);
  const filter: Record<string, unknown> = { status: req.query.status ? { $in: String(req.query.status).split(",") } : "abierta" };
  if (req.query.type) filter.type = req.query.type;
  if (req.auth!.role === "local" && req.auth!.branch) filter.branch = new Types.ObjectId(req.auth!.branch);
  else if (!["admin", "gerencia"].includes(req.auth!.role)) filter.audience = req.auth!.role;
  const [items, total] = await Promise.all([Alert.find(filter).sort({ severity: -1, createdAt: -1 }).skip(q.skip).limit(q.limit), Alert.countDocuments(filter)]);
  res.json(paged(items, total, q));
});
export const resolveAlert = h(async (req, res) => {
  const alert = await Alert.findById(req.params.id);
  if (!alert) throw notFound("Alerta no encontrada");
  alert.status = str(req.body.action) === "descartar" ? "descartada" : "atendida";
  alert.note = str(req.body.note); alert.resolvedBy = req.auth!.name; alert.resolvedAt = new Date();
  await alert.save();
  await audit(req.auth, "cerrar_alerta", { type: "Alert", id: alert._id, label: alert.title }, { status: alert.status, note: alert.note });
  res.json({ alert });
});

// ---------- Configuración ----------
export const getConfig = h(async (_req, res) => { res.json({ settings: await getSettings() }); });
export const updateConfig = h(async (req, res) => {
  const s = await getSettings();
  const b = req.body;
  for (const k of ["safetyStockPct", "weeksForAverage", "inflatedThresholdPct", "countDiffAlertPct", "reservationSlotMin"] as const) if (b[k] !== undefined) s[k] = num(b[k]);
  for (const k of ["orderCutoff", "whatsappNumber", "assistantName"] as const) if (b[k] !== undefined) s[k] = str(b[k]);
  await Settings.updateOne({ key: "global" }, s);
  await audit(req.auth, "editar_configuracion", { type: "Settings", label: "global" }, b);
  res.json({ settings: await getSettings() });
});

// ---------- Bitácora ----------
export const listAudit = h(async (req, res) => {
  const q = pageQuery(req, 100);
  const filter: Record<string, unknown> = {};
  if (req.query.action) filter.action = req.query.action;
  if (req.query.user) filter.userName = { $regex: String(req.query.user), $options: "i" };
  const [items, total] = await Promise.all([AuditEvent.find(filter).sort({ at: -1 }).skip(q.skip).limit(q.limit), AuditEvent.countDocuments(filter)]);
  res.json(paged(items, total, q));
});

// ---------- Reportes ----------
export const reports = h(async (req, res) => {
  const to = String(req.query.to ?? ecuadorDateString());
  const from = String(req.query.from ?? addDaysStr(to, -29));
  const kind = String(req.query.kind ?? "ventas");
  const branch = req.auth!.role === "local" ? req.auth!.branch ?? undefined : req.query.branch ? String(req.query.branch) : undefined;
  if (kind === "ventas") { res.json(await salesReport(from, to, branch)); return; }
  if (kind === "inventario") { res.json(await countDiffReport(from, to)); return; }
  if (kind === "pedidos") { res.json(await orderBehaviorReport(from, to)); return; }
  throw badRequest("Reporte desconocido");
});

// ---------- Asistente ----------
export const assistantStatus = h(async (req, res) => { res.json({ configured: assistantConfigured(), snapshot: await businessSnapshot(req.auth) }); });
export const ask = h(async (req, res) => {
  const question = str(req.body.question);
  if (!question) throw badRequest("Escribe una pregunta");
  const history = Array.isArray(req.body.history) ? req.body.history.filter((m: { role: string; text: string }) => ["user", "assistant"].includes(m.role) && typeof m.text === "string") : [];
  res.json(await askAssistant(req.auth, question, history));
});

// ---------- Fotos ----------
export const mediaSign = h(async (req, res) => { if (!mediaConfigured()) throw badRequest("Las fotos no están configuradas (Cloudinary)"); res.json(signUpload({ folder: str(req.body.folder, "general"), publicId: req.body.publicId ? str(req.body.publicId) : undefined, tags: Array.isArray(req.body.tags) ? req.body.tags : [] })); });

// ---------- Interno ----------
export const cronDaily = h(async (_req, res) => { res.json(await runDailyCron()); });

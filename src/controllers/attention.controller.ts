import { Types } from "mongoose";
import { Conversation, CONVERSATION_STATUSES, CONVERSATION_TOPICS } from "../models/conversation.model";
import { Review } from "../models/review.model";
import { Branch } from "../models/branch.model";
import { badRequest, notFound } from "../errors/httpError";
import { h, str } from "../utils/handler";
import { num } from "../utils/numbers";
import { pageQuery, paged } from "../utils/pagination";
import { audit } from "../services/audit.service";

// ---------- WhatsApp / conversaciones ----------
export const listConversations = h(async (req, res) => {
  const q = pageQuery(req, 50);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = { $in: String(req.query.status).split(",") };
  if (req.query.q) filter.$or = [{ name: { $regex: String(req.query.q), $options: "i" } }, { phone: { $regex: String(req.query.q), $options: "i" } }];
  const [items, total] = await Promise.all([Conversation.find(filter, { messages: { $slice: -1 } }).sort({ lastMessageAt: -1 }).skip(q.skip).limit(q.limit), Conversation.countDocuments(filter)]);
  res.json(paged(items, total, q));
});
export const getConversation = h(async (req, res) => {
  const c = await Conversation.findById(req.params.id);
  if (!c) throw notFound("Conversación no encontrada");
  if (c.unread) { c.unread = 0; await c.save(); }
  res.json({ conversation: c });
});
/** Mensaje entrante (lo registra la persona de atención, el agente o el webhook). Crea la conversación si no existe. */
export const inbound = h(async (req, res) => {
  const { phone, name, text, branch, topic } = req.body;
  if (!phone || !text) throw badRequest("Teléfono y texto son obligatorios");
  const by = req.auth?.name ?? "agente";
  let c = await Conversation.findOne({ phone: str(phone), status: { $ne: "cerrada" } });
  if (!c) c = new Conversation({ phone: str(phone), name: str(name), topic: CONVERSATION_TOPICS.includes(topic) ? topic : "consulta", branch: branch ? new Types.ObjectId(String(branch)) : null });
  if (name && !c.name) c.name = str(name);
  c.messages.push({ direction: "entrante", text: str(text), by: str(name) || c.phone, at: new Date() });
  c.lastMessageAt = new Date(); c.lastText = str(text); c.unread += 1; c.status = "abierta";
  await c.save();
  void by;
  res.status(201).json({ conversation: c });
});
export const reply = h(async (req, res) => {
  const c = await Conversation.findById(req.params.id);
  if (!c) throw notFound("Conversación no encontrada");
  if (!str(req.body.text)) throw badRequest("Escribe la respuesta");
  c.messages.push({ direction: "saliente", text: str(req.body.text), by: req.auth?.name ?? "agente", at: new Date() });
  c.lastMessageAt = new Date(); c.lastText = str(req.body.text); c.unread = 0;
  if (req.body.status && CONVERSATION_STATUSES.includes(req.body.status)) c.status = req.body.status; else if (c.status === "abierta") c.status = "esperando";
  if (!c.assignedTo && req.auth) c.assignedTo = req.auth.name;
  await c.save();
  res.json({ conversation: c });
});
export const updateConversation = h(async (req, res) => {
  const c = await Conversation.findById(req.params.id);
  if (!c) throw notFound("Conversación no encontrada");
  const b = req.body;
  if (b.status !== undefined) { if (!CONVERSATION_STATUSES.includes(b.status)) throw badRequest("Estado inválido"); c.status = b.status; }
  if (b.topic !== undefined && CONVERSATION_TOPICS.includes(b.topic)) c.topic = b.topic;
  if (b.name !== undefined) c.name = str(b.name);
  if (b.assignedTo !== undefined) c.assignedTo = str(b.assignedTo);
  if (b.branch !== undefined) c.branch = b.branch ? new Types.ObjectId(String(b.branch)) : null;
  await c.save();
  res.json({ conversation: c });
});

// ---------- Reseñas ----------
export const listReviews = h(async (req, res) => {
  const q = pageQuery(req, 50);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = { $in: String(req.query.status).split(",") };
  if (req.query.branch) filter.branch = new Types.ObjectId(String(req.query.branch));
  if (req.query.rating) filter.rating = num(req.query.rating);
  const [items, total, stats] = await Promise.all([
    Review.find(filter).sort({ reviewedAt: -1 }).skip(q.skip).limit(q.limit),
    Review.countDocuments(filter),
    Review.aggregate([{ $group: { _id: "$branchName", avg: { $avg: "$rating" }, count: { $sum: 1 }, pending: { $sum: { $cond: [{ $eq: ["$status", "nueva"] }, 1, 0] } } } }, { $sort: { avg: 1 } }]),
  ]);
  res.json({ ...paged(items, total, q), stats });
});
/** Entrada de reseñas (manual o desde la integración de Google). */
export const createReview = h(async (req, res) => {
  const { branch, source, externalId, author, rating, text, reviewedAt } = req.body;
  if (!rating) throw badRequest("La calificación es obligatoria");
  const b = branch ? await Branch.findById(branch) : null;
  if (externalId) { const dup = await Review.findOne({ source: source ?? "google", externalId: str(externalId) }); if (dup) { res.json({ review: dup, duplicate: true }); return; } }
  const r = await Review.create({ branch: b?._id ?? null, branchName: b?.name ?? "", source: source ?? "google", externalId: str(externalId), author: str(author), rating: Math.min(5, Math.max(1, num(rating))), text: str(text), reviewedAt: reviewedAt ? new Date(reviewedAt) : new Date() });
  res.status(201).json({ review: r });
});
export const replyReview = h(async (req, res) => {
  const r = await Review.findById(req.params.id);
  if (!r) throw notFound("Reseña no encontrada");
  if (req.body.status === "escalada") { r.status = "escalada"; }
  else { if (!str(req.body.reply)) throw badRequest("Escribe la respuesta"); r.reply = str(req.body.reply); r.repliedBy = req.auth?.name ?? "agente"; r.repliedAt = new Date(); r.status = "respondida"; }
  await r.save();
  await audit(req.auth, "responder_resena", { type: "Review", id: r._id, label: `${r.rating}★ ${r.author}` }, { status: r.status });
  res.json({ review: r });
});

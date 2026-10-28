import { Types } from "mongoose";
import { InternalOrder } from "../models/internalOrder.model";
import { badRequest, notFound } from "../errors/httpError";
import { h, str } from "../utils/handler";
import { pageQuery, paged } from "../utils/pagination";
import { addDaysStr, ecuadorDateString } from "../utils/dates";
import { suggestOrder } from "../services/forecast.service";
import * as svc from "../services/order.service";
import { assertBranchAccess } from "./catalog.controller";

export const suggestion = h(async (req, res) => {
  const branch = String(req.query.branch ?? req.auth!.branch ?? "");
  if (!branch) throw badRequest("Indica el local");
  assertBranchAccess(req.auth, branch);
  const date = String(req.query.date ?? addDaysStr(ecuadorDateString(), 1));
  res.json(await suggestOrder(new Types.ObjectId(branch), date));
});

export const listOrders = h(async (req, res) => {
  const q = pageQuery(req, 50);
  const filter: Record<string, unknown> = {};
  const branchId = req.query.branch ? String(req.query.branch) : req.auth!.role === "local" ? req.auth!.branch : null;
  if (branchId) { assertBranchAccess(req.auth, branchId); filter.branch = new Types.ObjectId(branchId); }
  if (req.query.status) filter.status = { $in: String(req.query.status).split(",") };
  if (req.query.date) filter.deliveryDate = String(req.query.date);
  if (req.query.from || req.query.to) filter.deliveryDate = { ...(req.query.from ? { $gte: String(req.query.from) } : {}), ...(req.query.to ? { $lte: String(req.query.to) } : {}) };
  const [items, total] = await Promise.all([InternalOrder.find(filter).sort({ deliveryDate: -1, createdAt: -1 }).skip(q.skip).limit(q.limit), InternalOrder.countDocuments(filter)]);
  res.json(paged(items, total, q));
});

export const getOrder = h(async (req, res) => {
  const order = await InternalOrder.findById(req.params.id);
  if (!order) throw notFound("Pedido no encontrado");
  assertBranchAccess(req.auth, String(order.branch));
  res.json({ order });
});

export const draft = h(async (req, res) => {
  const branch = String(req.body.branch ?? req.auth!.branch ?? "");
  if (!branch) throw badRequest("Indica el local");
  assertBranchAccess(req.auth, branch);
  const date = String(req.body.deliveryDate ?? addDaysStr(ecuadorDateString(), 1));
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest("Fecha inválida");
  res.status(201).json({ order: await svc.draftOrder(req.auth!, branch, date) });
});

export const update = h(async (req, res) => {
  const order = await InternalOrder.findById(req.params.id);
  if (!order) throw notFound("Pedido no encontrado");
  assertBranchAccess(req.auth, String(order.branch));
  res.json({ order: await svc.updateAndSend(req.auth!, req.params.id as string, { items: req.body.items, notes: req.body.notes, send: Boolean(req.body.send) }) });
});

export const approve = h(async (req, res) => { res.json({ order: await svc.approveOrder(req.auth!, req.params.id as string, req.body) }); });
export const dispatch = h(async (req, res) => { res.json({ order: await svc.dispatchOrder(req.auth!, req.params.id as string, req.body) }); });
export const receive = h(async (req, res) => {
  const order = await InternalOrder.findById(req.params.id);
  if (!order) throw notFound("Pedido no encontrado");
  assertBranchAccess(req.auth, String(order.branch));
  res.json({ order: await svc.receiveOrder(req.auth!, req.params.id as string, req.body) });
});
export const cancel = h(async (req, res) => {
  const order = await InternalOrder.findById(req.params.id);
  if (!order) throw notFound("Pedido no encontrado");
  assertBranchAccess(req.auth, String(order.branch));
  res.json({ order: await svc.cancelOrder(req.auth!, req.params.id as string, str(req.body.note)) });
});

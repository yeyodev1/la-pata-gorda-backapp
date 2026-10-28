import { Purchase } from "../models/purchase.model";
import { notFound } from "../errors/httpError";
import { h } from "../utils/handler";
import { pageQuery, paged } from "../utils/pagination";
import * as svc from "../services/purchase.service";

export const listPurchases = h(async (req, res) => {
  const q = pageQuery(req, 50);
  const filter: Record<string, unknown> = {};
  if (req.query.status) filter.status = { $in: String(req.query.status).split(",") };
  const [items, total] = await Promise.all([Purchase.find(filter).populate("supplier", "name").sort({ createdAt: -1 }).skip(q.skip).limit(q.limit), Purchase.countDocuments(filter)]);
  res.json(paged(items, total, q));
});
export const getPurchase = h(async (req, res) => {
  const purchase = await Purchase.findById(req.params.id).populate("supplier", "name phone");
  if (!purchase) throw notFound("Compra no encontrada");
  res.json({ purchase });
});
export const create = h(async (req, res) => { res.status(201).json({ purchase: await svc.createPurchase(req.auth!, req.body) }); });
export const update = h(async (req, res) => { res.json({ purchase: await svc.updatePurchase(req.auth!, req.params.id as string, req.body) }); });
export const receive = h(async (req, res) => { res.json({ purchase: await svc.receivePurchase(req.auth!, req.params.id as string, req.body) }); });

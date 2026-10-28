import { ProductionPlan } from "../models/productionPlan.model";
import { notFound } from "../errors/httpError";
import { h, str } from "../utils/handler";
import { pageQuery, paged } from "../utils/pagination";
import { ecuadorDateString, addDaysStr } from "../utils/dates";
import * as svc from "../services/production.service";

export const listPlans = h(async (req, res) => {
  const q = pageQuery(req, 30);
  const [items, total] = await Promise.all([ProductionPlan.find().sort({ date: -1 }).skip(q.skip).limit(q.limit), ProductionPlan.countDocuments()]);
  res.json(paged(items, total, q));
});
export const getPlan = h(async (req, res) => {
  const plan = await ProductionPlan.findById(req.params.id);
  if (!plan) throw notFound("Plan no encontrado");
  res.json({ plan });
});
export const build = h(async (req, res) => {
  const date = String(req.body.date ?? addDaysStr(ecuadorDateString(), 1));
  res.status(201).json({ plan: await svc.buildPlan(req.auth!, date) });
});
export const produce = h(async (req, res) => { res.json({ plan: await svc.registerProduction(req.auth!, req.params.id as string, req.body) }); });
export const close = h(async (req, res) => { res.json({ plan: await svc.closePlan(req.auth!, req.params.id as string, str(req.body.notes)) }); });

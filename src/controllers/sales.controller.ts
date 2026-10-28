import { Types } from "mongoose";
import { DailySales } from "../models/dailySales.model";
import { badRequest } from "../errors/httpError";
import { h } from "../utils/handler";
import { pageQuery, paged } from "../utils/pagination";
import { closeDailySales } from "../services/sales.service";
import { audit } from "../services/audit.service";
import { assertBranchAccess } from "./catalog.controller";

export const listSales = h(async (req, res) => {
  const q = pageQuery(req, 60);
  const filter: Record<string, unknown> = {};
  const branchId = req.query.branch ? String(req.query.branch) : req.auth!.role === "local" ? req.auth!.branch : null;
  if (branchId) { assertBranchAccess(req.auth, branchId); filter.branch = new Types.ObjectId(branchId); }
  if (req.query.from || req.query.to) filter.date = { ...(req.query.from ? { $gte: String(req.query.from) } : {}), ...(req.query.to ? { $lte: String(req.query.to) } : {}) };
  const [items, total] = await Promise.all([DailySales.find(filter).populate("branch", "name").sort({ date: -1 }).skip(q.skip).limit(q.limit), DailySales.countDocuments(filter)]);
  res.json(paged(items, total, q));
});

export const getSales = h(async (req, res) => {
  const branchId = String(req.query.branch ?? req.auth!.branch ?? "");
  const date = String(req.query.date ?? "");
  if (!branchId || !date) throw badRequest("Local y fecha son obligatorios");
  assertBranchAccess(req.auth, branchId);
  const sales = await DailySales.findOne({ branch: new Types.ObjectId(branchId), date });
  res.json({ sales });
});

/** Cierre de ventas del día (manual o importado). Descarga inventario por receta. */
export const closeSales = h(async (req, res) => {
  const branch = String(req.body.branch ?? req.auth!.branch ?? "");
  assertBranchAccess(req.auth, branch);
  const doc = await closeDailySales(req.auth, { branch, date: String(req.body.date ?? ""), items: Array.isArray(req.body.items) ? req.body.items : [], tickets: Number(req.body.tickets ?? 0), source: req.body.source });
  await audit(req.auth, "cerrar_ventas", { type: "DailySales", id: doc._id, label: `${doc.date}` }, { total: doc.totalAmount, items: doc.items.length });
  res.status(201).json({ sales: doc });
});

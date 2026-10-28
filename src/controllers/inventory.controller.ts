import { Types } from "mongoose";
import { StockLevel, StockMovement } from "../models/stock.model";
import { Ingredient } from "../models/ingredient.model";
import { DailyCount } from "../models/dailyCount.model";
import { Branch } from "../models/branch.model";
import { getSettings } from "../models/settings.model";
import { raiseAlert } from "../models/alert.model";
import { badRequest, notFound } from "../errors/httpError";
import { h, str } from "../utils/handler";
import { num, round2, round3 } from "../utils/numbers";
import { pageQuery, paged } from "../utils/pagination";
import { ecuadorDateString } from "../utils/dates";
import { moveStock, setStock } from "../services/inventory.service";
import { audit } from "../services/audit.service";
import { assertBranchAccess } from "./catalog.controller";

/** Existencias de un lugar, con todos los insumos activos (aunque estén en 0). */
export const stockOf = h(async (req, res) => {
  const branchId = String(req.query.branch ?? req.auth!.branch ?? "");
  if (!branchId) throw badRequest("Indica el local");
  assertBranchAccess(req.auth, branchId);
  const branch = await Branch.findById(branchId);
  if (!branch) throw notFound("Local no encontrado");
  const [ingredients, levels] = await Promise.all([Ingredient.find({ active: true }).sort({ group: 1, name: 1 }), StockLevel.find({ branch: branch._id })]);
  const byIng = new Map(levels.map((l) => [String(l.ingredient), l]));
  const items = ingredients.map((ing) => {
    const l = byIng.get(String(ing._id));
    return { ingredient: ing._id, name: ing.name, code: ing.code, group: ing.group, unit: ing.unit, cost: ing.cost, producedInHouse: ing.producedInHouse, minStock: ing.minStock, qty: round3(l?.qty ?? 0), value: round2((l?.qty ?? 0) * ing.cost), low: ing.minStock > 0 && (l?.qty ?? 0) < ing.minStock, updatedAt: l?.updatedAt ?? null };
  });
  res.json({ branch: { id: branch._id, name: branch.name, type: branch.type }, items, totalValue: round2(items.reduce((a, b) => a + b.value, 0)) });
});

/** Resumen de existencias de todos los lugares (gerencia / producción). */
export const stockOverview = h(async (_req, res) => {
  const [branches, ingredients, levels] = await Promise.all([Branch.find({ active: true }).sort({ type: 1, order: 1 }), Ingredient.find({ active: true }).sort({ group: 1, name: 1 }), StockLevel.find()]);
  const key = (b: unknown, i: unknown) => `${String(b)}|${String(i)}`;
  const map = new Map(levels.map((l) => [key(l.branch, l.ingredient), l.qty]));
  const rows = ingredients.map((ing) => ({ ingredient: ing._id, name: ing.name, unit: ing.unit, group: ing.group, producedInHouse: ing.producedInHouse, minStock: ing.minStock, byBranch: branches.map((b) => ({ branch: b._id, qty: round3(map.get(key(b._id, ing._id)) ?? 0) })), total: round3(branches.reduce((a, b) => a + (map.get(key(b._id, ing._id)) ?? 0), 0)) }));
  res.json({ branches: branches.map((b) => ({ id: b._id, name: b.name, type: b.type })), rows });
});

export const movements = h(async (req, res) => {
  const q = pageQuery(req, 100);
  const filter: Record<string, unknown> = {};
  const branchId = req.query.branch ? String(req.query.branch) : req.auth!.role === "local" ? req.auth!.branch : null;
  if (branchId) { assertBranchAccess(req.auth, branchId); filter.branch = new Types.ObjectId(branchId); }
  if (req.query.ingredient) filter.ingredient = new Types.ObjectId(String(req.query.ingredient));
  if (req.query.type) filter.type = req.query.type;
  if (req.query.from || req.query.to) filter.at = { ...(req.query.from ? { $gte: new Date(`${req.query.from}T00:00:00-05:00`) } : {}), ...(req.query.to ? { $lte: new Date(`${req.query.to}T23:59:59-05:00`) } : {}) };
  const [items, total] = await Promise.all([StockMovement.find(filter).populate("ingredient", "name unit").populate("branch", "name").sort({ at: -1 }).skip(q.skip).limit(q.limit), StockMovement.countDocuments(filter)]);
  res.json(paged(items, total, q));
});

/** Ajuste manual (ingreso, egreso, merma) con motivo obligatorio. */
export const adjust = h(async (req, res) => {
  const { branch, ingredient, type, qty, note } = req.body;
  if (!branch || !ingredient || !type) throw badRequest("Local, insumo y tipo son obligatorios");
  if (!["ingreso", "egreso", "merma", "ajuste"].includes(type)) throw badRequest("Tipo de movimiento inválido");
  if (!str(note)) throw badRequest("Indica el motivo del movimiento");
  assertBranchAccess(req.auth, String(branch));
  const n = Math.abs(num(qty));
  if (!n) throw badRequest("Cantidad inválida");
  const signed = type === "ingreso" ? n : type === "ajuste" ? num(qty) : -n;
  const balance = await moveStock({ branch, ingredient, type, qty: signed, note: str(note), userName: req.auth!.name, refType: "Manual" });
  await audit(req.auth, "ajuste_inventario", { type: "Ingredient", id: ingredient, label: type }, { branch, qty: signed, note });
  res.json({ balance });
});

/** Conteo físico del día: fija existencias y registra diferencias; alerta si la diferencia es grande. */
export const dailyCount = h(async (req, res) => {
  const { branch, date, items, note } = req.body as { branch: string; date?: string; items: { ingredient: string; counted: number }[]; note?: string };
  if (!branch || !Array.isArray(items) || !items.length) throw badRequest("Local y conteo son obligatorios");
  assertBranchAccess(req.auth, String(branch));
  const b = await Branch.findById(branch);
  if (!b) throw notFound("Local no encontrado");
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : ecuadorDateString();
  const settings = await getSettings();
  const ings = await Ingredient.find({ _id: { $in: items.map((i) => new Types.ObjectId(i.ingredient)) } });
  const byId = new Map(ings.map((i) => [String(i._id), i]));
  const lines = [];
  let diffValue = 0;
  for (const it of items) {
    const ing = byId.get(it.ingredient);
    if (!ing || !Number.isFinite(Number(it.counted))) continue;
    const r = await setStock({ branch, ingredient: ing._id, qty: Math.max(0, num(it.counted)), note: `Conteo ${day}`, userName: req.auth!.name, refType: "DailyCount" });
    lines.push({ ingredient: ing._id, ingredientName: ing.name, expected: round3(r.before), counted: r.after, diff: r.diff });
    diffValue = round2(diffValue + r.diff * ing.cost);
    const pct = r.before > 0 ? Math.abs(r.diff / r.before) * 100 : r.diff !== 0 ? 100 : 0;
    if (Math.abs(r.diff) > 0.0001 && pct >= settings.countDiffAlertPct && Math.abs(r.diff * ing.cost) >= 5) {
      await raiseAlert({ type: "diferencia_inventario", severity: r.diff < 0 ? "warning" : "info", title: `${b.name}: ${ing.name} ${r.diff < 0 ? "faltan" : "sobran"} ${Math.abs(r.diff)} ${ing.unit}`, body: `Sistema: ${r.before} · Contado: ${r.after} · ${round2(pct)} % · $${round2(Math.abs(r.diff * ing.cost))}`, branch: b._id, branchName: b.name, audience: ["gerencia", "produccion", "contabilidad"], key: `conteo:${b._id}:${ing._id}:${day}` });
    }
  }
  const doc = await DailyCount.findOneAndUpdate({ branch: b._id, date: day }, { branch: b._id, date: day, items: lines, diffValue, note: str(note), countedBy: req.auth!.name }, { new: true, upsert: true });
  await audit(req.auth, "conteo_inventario", { type: "DailyCount", id: doc!._id, label: `${b.name} ${day}` }, { diffValue });
  res.json({ count: doc });
});

export const listCounts = h(async (req, res) => {
  const q = pageQuery(req, 50);
  const filter: Record<string, unknown> = {};
  const branchId = req.query.branch ? String(req.query.branch) : req.auth!.role === "local" ? req.auth!.branch : null;
  if (branchId) { assertBranchAccess(req.auth, branchId); filter.branch = new Types.ObjectId(branchId); }
  const [items, total] = await Promise.all([DailyCount.find(filter).populate("branch", "name").sort({ date: -1 }).skip(q.skip).limit(q.limit), DailyCount.countDocuments(filter)]);
  res.json(paged(items, total, q));
});

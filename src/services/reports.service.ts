import { Types } from "mongoose";
import { DailySales } from "../models/dailySales.model";
import { DailyCount } from "../models/dailyCount.model";
import { InternalOrder } from "../models/internalOrder.model";
import { round2, round3 } from "../utils/numbers";
import { WEEKDAY_LABELS } from "../utils/dates";

/** Ventas por local y por día en un rango. */
export async function salesReport(from: string, to: string, branch?: string) {
  const filter: Record<string, unknown> = { date: { $gte: from, $lte: to } };
  if (branch) filter.branch = new Types.ObjectId(branch);
  const docs = await DailySales.find(filter).populate("branch", "name code").sort({ date: 1 });
  const byBranch = new Map<string, { branch: string; days: number; totalAmount: number; totalQty: number; tickets: number }>();
  const byDay = new Map<string, number>();
  const byWeekday = Array.from({ length: 7 }, (_, i) => ({ weekday: i, label: WEEKDAY_LABELS[i], days: 0, totalAmount: 0, avg: 0 }));
  const byProduct = new Map<string, { product: string; name: string; qty: number; amount: number }>();
  for (const d of docs) {
    const b = d.branch as unknown as { _id: Types.ObjectId; name: string };
    const key = String(b?._id ?? d.branch);
    const cur = byBranch.get(key) ?? { branch: b?.name ?? key, days: 0, totalAmount: 0, totalQty: 0, tickets: 0 };
    cur.days++; cur.totalAmount = round2(cur.totalAmount + d.totalAmount); cur.totalQty = round3(cur.totalQty + d.totalQty); cur.tickets += d.tickets;
    byBranch.set(key, cur);
    byDay.set(d.date, round2((byDay.get(d.date) ?? 0) + d.totalAmount));
    const w = byWeekday[d.weekday]!; w.days++; w.totalAmount = round2(w.totalAmount + d.totalAmount);
    for (const it of d.items) {
      const p = byProduct.get(String(it.product)) ?? { product: String(it.product), name: it.productName, qty: 0, amount: 0 };
      p.qty = round3(p.qty + it.qty); p.amount = round2(p.amount + it.amount);
      byProduct.set(String(it.product), p);
    }
  }
  for (const w of byWeekday) w.avg = w.days ? round2(w.totalAmount / w.days) : 0;
  const total = round2(docs.reduce((a, b) => a + b.totalAmount, 0));
  return {
    from, to, total,
    byBranch: [...byBranch.values()].sort((a, b) => b.totalAmount - a.totalAmount),
    byDay: [...byDay.entries()].map(([date, amount]) => ({ date, amount })),
    byWeekday,
    topProducts: [...byProduct.values()].sort((a, b) => b.qty - a.qty).slice(0, 25),
  };
}

/** Diferencias de inventario (conteos) por local en un rango. */
export async function countDiffReport(from: string, to: string) {
  const docs = await DailyCount.find({ date: { $gte: from, $lte: to } }).populate("branch", "name").sort({ date: -1 });
  const byBranch = new Map<string, { branch: string; counts: number; diffValue: number; lines: number }>();
  for (const d of docs) {
    const b = d.branch as unknown as { _id: Types.ObjectId; name: string };
    const key = String(b?._id ?? d.branch);
    const cur = byBranch.get(key) ?? { branch: b?.name ?? key, counts: 0, diffValue: 0, lines: 0 };
    cur.counts++; cur.diffValue = round2(cur.diffValue + d.diffValue); cur.lines += d.items.filter((i) => Math.abs(i.diff) > 0.0001).length;
    byBranch.set(key, cur);
  }
  return { from, to, byBranch: [...byBranch.values()].sort((a, b) => a.diffValue - b.diffValue), recent: docs.slice(0, 30) };
}

/** Pedidos: cuánto pide cada local vs lo sugerido (quién infla). */
export async function orderBehaviorReport(from: string, to: string) {
  const docs = await InternalOrder.find({ deliveryDate: { $gte: from, $lte: to }, status: { $ne: "anulado" } });
  const byBranch = new Map<string, { branch: string; orders: number; inflatedLines: number; requested: number; suggested: number; ratio: number }>();
  for (const o of docs) {
    const cur = byBranch.get(String(o.branch)) ?? { branch: o.branchName, orders: 0, inflatedLines: 0, requested: 0, suggested: 0, ratio: 0 };
    cur.orders++; cur.inflatedLines += o.inflatedCount;
    for (const it of o.items) { cur.requested = round3(cur.requested + it.requested); cur.suggested = round3(cur.suggested + it.suggested); }
    byBranch.set(String(o.branch), cur);
  }
  for (const b of byBranch.values()) b.ratio = b.suggested ? round2((b.requested / b.suggested) * 100) : 0;
  return { from, to, byBranch: [...byBranch.values()].sort((a, b) => b.ratio - a.ratio) };
}

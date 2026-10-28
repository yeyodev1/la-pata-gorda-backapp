import { Types } from "mongoose";
import { DailySales } from "../models/dailySales.model";
import { Product } from "../models/product.model";
import { badRequest, conflict } from "../errors/httpError";
import { weekdayOf } from "../utils/dates";
import { round2, round3 } from "../utils/numbers";
import { moveStock } from "./inventory.service";
import { AuthPayload } from "../middlewares/auth.middleware";

export interface SalesInput {
  branch: string;
  date: string;
  items: { product: string; qty: number; amount?: number }[];
  tickets?: number;
  source?: "manual" | "importado" | "api";
}

/** Registra (o reemplaza si aún no descargó inventario) las ventas del día y descarga el inventario por receta. */
export async function closeDailySales(auth: AuthPayload | undefined, input: SalesInput) {
  if (!input.branch || !input.date) throw badRequest("Local y fecha son obligatorios");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw badRequest("Fecha inválida (YYYY-MM-DD)");
  const branch = new Types.ObjectId(input.branch);
  const existing = await DailySales.findOne({ branch, date: input.date });
  if (existing?.consumed) throw conflict("Las ventas de ese día ya están cerradas y descargadas del inventario");
  const ids = input.items.filter((i) => i.qty > 0).map((i) => new Types.ObjectId(i.product));
  const products = await Product.find({ _id: { $in: ids } });
  const byId = new Map(products.map((p) => [String(p._id), p]));
  const items = input.items
    .filter((i) => i.qty > 0 && byId.has(i.product))
    .map((i) => {
      const p = byId.get(i.product)!;
      return { product: p._id, productName: p.name, qty: round3(i.qty), amount: round2(i.amount ?? p.price * i.qty) };
    });
  if (!items.length) throw badRequest("Agrega al menos un producto vendido");
  const totalQty = round3(items.reduce((a, b) => a + b.qty, 0));
  const totalAmount = round2(items.reduce((a, b) => a + b.amount, 0));
  const doc = await DailySales.findOneAndUpdate(
    { branch, date: input.date },
    { branch, date: input.date, weekday: weekdayOf(input.date), items, totalQty, totalAmount, tickets: input.tickets ?? 0, source: input.source ?? "manual", consumed: true, closedBy: auth?.name ?? "sistema" },
    { new: true, upsert: true },
  );
  // Descarga de inventario por receta
  const consumption = new Map<string, number>();
  for (const it of items) {
    const p = byId.get(String(it.product))!;
    for (const line of p.recipe) consumption.set(String(line.ingredient), round3((consumption.get(String(line.ingredient)) ?? 0) + line.qty * it.qty));
  }
  for (const [ingredient, qty] of consumption) await moveStock({ branch, ingredient, type: "venta", qty: -qty, refType: "DailySales", refId: doc!._id, note: `Ventas ${input.date}`, userName: auth?.name });
  return doc!;
}

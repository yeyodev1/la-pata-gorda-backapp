import { Types } from "mongoose";
import { DailySales } from "../models/dailySales.model";
import { Product } from "../models/product.model";
import { Ingredient, IIngredient } from "../models/ingredient.model";
import { getSettings } from "../models/settings.model";
import { addDaysStr, weekdayOf } from "../utils/dates";
import { round3 } from "../utils/numbers";
import { stockMap } from "./inventory.service";

/**
 * Promedio de ventas por producto de un local para un día de la semana,
 * mirando las últimas N semanas (solo días con ventas cerradas).
 */
export async function averageSalesByWeekday(branch: Types.ObjectId | string, weekday: number, weeks: number): Promise<{ days: number; perProduct: Map<string, number> }> {
  const since = addDaysStr(new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10), -7 * weeks);
  const docs = await DailySales.find({ branch: new Types.ObjectId(String(branch)), weekday, date: { $gte: since } });
  const sum = new Map<string, number>();
  for (const d of docs) for (const it of d.items) sum.set(String(it.product), (sum.get(String(it.product)) ?? 0) + it.qty);
  const days = docs.length;
  const perProduct = new Map<string, number>();
  if (days) for (const [k, v] of sum) perProduct.set(k, round3(v / days));
  return { days, perProduct };
}

/** Convierte ventas esperadas por producto en consumo esperado por insumo (recetas). */
export async function expectedConsumption(perProduct: Map<string, number>): Promise<Map<string, number>> {
  const ids = [...perProduct.keys()].map((id) => new Types.ObjectId(id));
  const products = await Product.find({ _id: { $in: ids } });
  const need = new Map<string, number>();
  for (const p of products) {
    const qty = perProduct.get(String(p._id)) ?? 0;
    for (const line of p.recipe) need.set(String(line.ingredient), round3((need.get(String(line.ingredient)) ?? 0) + line.qty * qty));
  }
  return need;
}

export interface SuggestionLine {
  ingredient: string;
  ingredientName: string;
  unit: string;
  producedInHouse: boolean;
  stock: number;
  expected: number;
  suggested: number;
}

/**
 * Sugerencia de pedido de un local para una fecha:
 *   esperado = consumo del día de semana (promedio) × (1 + seguridad)
 *   sugerido = max(0, esperado − existencia actual)
 * Incluye todos los preparados/insumos que produce el centro de producción, aunque no haya historial (sugerido 0).
 */
export async function suggestOrder(branch: Types.ObjectId | string, deliveryDate: string): Promise<{ lines: SuggestionLine[]; basedOnDays: number; weekday: number; safetyPct: number }> {
  const settings = await getSettings();
  const weekday = weekdayOf(deliveryDate);
  const { days, perProduct } = await averageSalesByWeekday(branch, weekday, settings.weeksForAverage);
  const need = await expectedConsumption(perProduct);
  const stock = await stockMap(branch);
  const ingredients = await Ingredient.find({ active: true, $or: [{ producedInHouse: true }, { _id: { $in: [...need.keys()].map((id) => new Types.ObjectId(id)) } }] }).sort({ group: 1, name: 1 });
  const factor = 1 + settings.safetyStockPct / 100;
  const lines: SuggestionLine[] = ingredients.map((ing: IIngredient & { _id: Types.ObjectId }) => {
    const id = String(ing._id);
    const base = need.get(id) ?? 0;
    const expected = round3(base * factor);
    const cur = stock.get(id) ?? 0;
    return { ingredient: id, ingredientName: ing.name, unit: ing.unit, producedInHouse: ing.producedInHouse, stock: round3(cur), expected, suggested: round3(Math.max(0, expected - cur)) };
  });
  return { lines, basedOnDays: days, weekday, safetyPct: settings.safetyStockPct };
}

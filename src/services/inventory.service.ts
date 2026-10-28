import { Types } from "mongoose";
import { StockLevel, StockMovement, MovementType } from "../models/stock.model";
import { round3 } from "../utils/numbers";

export interface MoveInput {
  branch: Types.ObjectId | string;
  ingredient: Types.ObjectId | string;
  type: MovementType;
  /** Positivo entra, negativo sale. */
  qty: number;
  refType?: string;
  refId?: Types.ObjectId | string | null;
  note?: string;
  userName?: string;
}

/** Aplica un movimiento de inventario y deja el kardex. Devuelve la existencia resultante. */
export async function moveStock(input: MoveInput): Promise<number> {
  const branch = new Types.ObjectId(String(input.branch));
  const ingredient = new Types.ObjectId(String(input.ingredient));
  const qty = round3(input.qty);
  if (!qty) {
    const cur = await StockLevel.findOne({ branch, ingredient });
    return cur?.qty ?? 0;
  }
  const level = await StockLevel.findOneAndUpdate({ branch, ingredient }, { $inc: { qty } }, { new: true, upsert: true });
  await StockMovement.create({
    branch,
    ingredient,
    type: input.type,
    qty,
    balance: round3(level!.qty),
    refType: input.refType ?? "",
    refId: input.refId ? new Types.ObjectId(String(input.refId)) : null,
    note: input.note ?? "",
    userName: input.userName ?? "",
  });
  return round3(level!.qty);
}

/** Fija la existencia en un valor (conteo físico): registra la diferencia como movimiento. */
export async function setStock(input: Omit<MoveInput, "qty" | "type"> & { qty: number; type?: MovementType }): Promise<{ before: number; after: number; diff: number }> {
  const branch = new Types.ObjectId(String(input.branch));
  const ingredient = new Types.ObjectId(String(input.ingredient));
  const cur = await StockLevel.findOne({ branch, ingredient });
  const before = cur?.qty ?? 0;
  const diff = round3(input.qty - before);
  if (diff) await moveStock({ ...input, qty: diff, type: input.type ?? "conteo" });
  else if (!cur) await StockLevel.create({ branch, ingredient, qty: 0 });
  return { before, after: round3(input.qty), diff };
}

/** Mapa ingredientId → existencia para un lugar. */
export async function stockMap(branch: Types.ObjectId | string): Promise<Map<string, number>> {
  const levels = await StockLevel.find({ branch: new Types.ObjectId(String(branch)) });
  return new Map(levels.map((l) => [String(l.ingredient), l.qty]));
}

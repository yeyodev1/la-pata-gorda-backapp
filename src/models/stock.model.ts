import mongoose, { Schema, Types } from "mongoose";

/** Existencia actual de un insumo en un lugar (local, producción o bodega). */
export interface IStockLevel {
  branch: Types.ObjectId;
  ingredient: Types.ObjectId;
  qty: number;
  updatedAt?: Date;
}
const stockLevelSchema = new Schema<IStockLevel>({ branch: { type: Schema.Types.ObjectId, ref: "Branch", required: true }, ingredient: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true }, qty: { type: Number, default: 0 } }, { timestamps: true });
stockLevelSchema.index({ branch: 1, ingredient: 1 }, { unique: true });
export const StockLevel = (mongoose.models.StockLevel as mongoose.Model<IStockLevel>) || mongoose.model<IStockLevel>("StockLevel", stockLevelSchema);

export const MOVEMENT_TYPES = ["ingreso", "egreso", "venta", "produccion", "consumo_produccion", "despacho", "recepcion", "ajuste", "merma", "conteo"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Kardex: cada cambio de existencia queda registrado con motivo y referencia. */
export interface IStockMovement {
  branch: Types.ObjectId;
  ingredient: Types.ObjectId;
  type: MovementType;
  /** Positivo entra, negativo sale. */
  qty: number;
  /** Existencia después del movimiento. */
  balance: number;
  refType: string;
  refId: Types.ObjectId | null;
  note: string;
  userName: string;
  at: Date;
}
const stockMovementSchema = new Schema<IStockMovement>({
  branch: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
  ingredient: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true, index: true },
  type: { type: String, enum: MOVEMENT_TYPES, required: true },
  qty: { type: Number, required: true },
  balance: { type: Number, required: true },
  refType: { type: String, default: "" },
  refId: { type: Schema.Types.ObjectId, default: null },
  note: { type: String, default: "" },
  userName: { type: String, default: "" },
  at: { type: Date, default: Date.now, index: true },
});
export const StockMovement = (mongoose.models.StockMovement as mongoose.Model<IStockMovement>) || mongoose.model<IStockMovement>("StockMovement", stockMovementSchema);

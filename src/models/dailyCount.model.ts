import mongoose, { Schema, Types } from "mongoose";

export interface ICountLine {
  ingredient: Types.ObjectId;
  ingredientName: string;
  /** Lo que dice el sistema antes del conteo. */
  expected: number;
  /** Lo que contó el administrador. */
  counted: number;
  diff: number;
}

/** Conteo físico de inventario de un local al cierre del día. Ajusta las existencias y deja la diferencia registrada. */
export interface IDailyCount {
  branch: Types.ObjectId;
  date: string;
  items: ICountLine[];
  /** Valor de las diferencias (a costo). */
  diffValue: number;
  note: string;
  countedBy: string;
  createdAt?: Date;
}

const lineSchema = new Schema<ICountLine>({ ingredient: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true }, ingredientName: { type: String, default: "" }, expected: { type: Number, default: 0 }, counted: { type: Number, default: 0 }, diff: { type: Number, default: 0 } }, { _id: false });

const dailyCountSchema = new Schema<IDailyCount>(
  {
    branch: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    date: { type: String, required: true },
    items: { type: [lineSchema], default: [] },
    diffValue: { type: Number, default: 0 },
    note: { type: String, default: "" },
    countedBy: { type: String, default: "" },
  },
  { timestamps: true },
);
dailyCountSchema.index({ branch: 1, date: 1 }, { unique: true });

export const DailyCount = (mongoose.models.DailyCount as mongoose.Model<IDailyCount>) || mongoose.model<IDailyCount>("DailyCount", dailyCountSchema);

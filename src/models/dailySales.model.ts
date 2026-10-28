import mongoose, { Schema, Types } from "mongoose";

export interface ISalesLine {
  product: Types.ObjectId;
  productName: string;
  qty: number;
  amount: number;
}

/** Ventas de un local en un día (lo que el POS/software del local vendió). Una por local y día. */
export interface IDailySales {
  branch: Types.ObjectId;
  date: string; // YYYY-MM-DD
  weekday: number; // 0 dom … 6 sáb
  items: ISalesLine[];
  totalQty: number;
  totalAmount: number;
  tickets: number;
  source: "manual" | "importado" | "api";
  /** Ya descargó inventario por recetas. */
  consumed: boolean;
  closedBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema<ISalesLine>({ product: { type: Schema.Types.ObjectId, ref: "Product", required: true }, productName: { type: String, default: "" }, qty: { type: Number, required: true, min: 0 }, amount: { type: Number, default: 0 } }, { _id: false });

const dailySalesSchema = new Schema<IDailySales>(
  {
    branch: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    date: { type: String, required: true },
    weekday: { type: Number, required: true },
    items: { type: [lineSchema], default: [] },
    totalQty: { type: Number, default: 0 },
    totalAmount: { type: Number, default: 0 },
    tickets: { type: Number, default: 0 },
    source: { type: String, enum: ["manual", "importado", "api"], default: "manual" },
    consumed: { type: Boolean, default: false },
    closedBy: { type: String, default: "" },
  },
  { timestamps: true },
);
dailySalesSchema.index({ branch: 1, date: 1 }, { unique: true });

export const DailySales = (mongoose.models.DailySales as mongoose.Model<IDailySales>) || mongoose.model<IDailySales>("DailySales", dailySalesSchema);

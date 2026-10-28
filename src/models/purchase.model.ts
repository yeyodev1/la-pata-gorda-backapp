import mongoose, { Schema, Types } from "mongoose";

export const PURCHASE_STATUSES = ["requerimiento", "pedida", "recibida", "anulada"] as const;
export type PurchaseStatus = (typeof PURCHASE_STATUSES)[number];

export interface IPurchaseLine {
  ingredient: Types.ObjectId;
  ingredientName: string;
  unit: string;
  qty: number;
  unitCost: number;
  receivedQty: number;
}

/** Compra de materia prima a un proveedor; al recibirla entra a bodega. */
export interface IPurchase {
  number: string;
  supplier: Types.ObjectId | null;
  supplierName: string;
  /** Dónde se recibe (bodega central por defecto). */
  branch: Types.ObjectId;
  status: PurchaseStatus;
  items: IPurchaseLine[];
  total: number;
  expectedAt: string;
  receivedAt: Date | null;
  invoiceNumber: string;
  notes: string;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema<IPurchaseLine>({ ingredient: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true }, ingredientName: String, unit: String, qty: { type: Number, required: true, min: 0 }, unitCost: { type: Number, default: 0 }, receivedQty: { type: Number, default: 0 } }, { _id: false });

const purchaseSchema = new Schema<IPurchase>(
  {
    number: { type: String, required: true, unique: true },
    supplier: { type: Schema.Types.ObjectId, ref: "Supplier", default: null },
    supplierName: { type: String, default: "" },
    branch: { type: Schema.Types.ObjectId, ref: "Branch", required: true },
    status: { type: String, enum: PURCHASE_STATUSES, default: "requerimiento", index: true },
    items: { type: [lineSchema], default: [] },
    total: { type: Number, default: 0 },
    expectedAt: { type: String, default: "" },
    receivedAt: { type: Date, default: null },
    invoiceNumber: { type: String, default: "" },
    notes: { type: String, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true },
);

export const Purchase = (mongoose.models.Purchase as mongoose.Model<IPurchase>) || mongoose.model<IPurchase>("Purchase", purchaseSchema);

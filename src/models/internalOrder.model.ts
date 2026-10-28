import mongoose, { Schema, Types } from "mongoose";

export const ORDER_STATUSES = ["borrador", "enviado", "aprobado", "despachado", "recibido", "anulado"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export interface IOrderLine {
  ingredient: Types.ObjectId;
  ingredientName: string;
  unit: string;
  /** Existencia del local al momento de pedir. */
  stock: number;
  /** Consumo esperado para la fecha (promedio del día de semana + seguridad). */
  expected: number;
  /** Lo que el sistema sugiere pedir. */
  suggested: number;
  /** Lo que el local pidió. */
  requested: number;
  /** Lo que producción aprobó. */
  approved: number;
  dispatched: number;
  received: number;
  /** Pidió bastante más que lo sugerido. */
  inflated: boolean;
  justification: string;
}

/** Pedido diario de un local al centro de producción. */
export interface IInternalOrder {
  number: string;
  branch: Types.ObjectId;
  branchName: string;
  /** Fecha para la que se necesita (normalmente mañana). */
  deliveryDate: string;
  status: OrderStatus;
  items: IOrderLine[];
  inflatedCount: number;
  notes: string;
  productionNote: string;
  createdBy: string;
  sentAt: Date | null;
  approvedBy: string;
  approvedAt: Date | null;
  dispatchedAt: Date | null;
  receivedBy: string;
  receivedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema<IOrderLine>(
  {
    ingredient: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true },
    ingredientName: { type: String, default: "" },
    unit: { type: String, default: "un" },
    stock: { type: Number, default: 0 },
    expected: { type: Number, default: 0 },
    suggested: { type: Number, default: 0 },
    requested: { type: Number, default: 0 },
    approved: { type: Number, default: 0 },
    dispatched: { type: Number, default: 0 },
    received: { type: Number, default: 0 },
    inflated: { type: Boolean, default: false },
    justification: { type: String, default: "" },
  },
  { _id: false },
);

const orderSchema = new Schema<IInternalOrder>(
  {
    number: { type: String, required: true, unique: true },
    branch: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    branchName: { type: String, default: "" },
    deliveryDate: { type: String, required: true, index: true },
    status: { type: String, enum: ORDER_STATUSES, default: "borrador", index: true },
    items: { type: [lineSchema], default: [] },
    inflatedCount: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    productionNote: { type: String, default: "" },
    createdBy: { type: String, default: "" },
    sentAt: { type: Date, default: null },
    approvedBy: { type: String, default: "" },
    approvedAt: { type: Date, default: null },
    dispatchedAt: { type: Date, default: null },
    receivedBy: { type: String, default: "" },
    receivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const InternalOrder = (mongoose.models.InternalOrder as mongoose.Model<IInternalOrder>) || mongoose.model<IInternalOrder>("InternalOrder", orderSchema);

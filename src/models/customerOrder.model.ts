import mongoose, { Schema, Types } from "mongoose";

export const CUSTOMER_ORDER_STATUSES = ["nuevo", "aceptado", "en_preparacion", "listo", "en_camino", "entregado", "cancelado"] as const;
export type CustomerOrderStatus = (typeof CUSTOMER_ORDER_STATUSES)[number];
export const FULFILLMENT_TYPES = ["retiro", "domicilio"] as const;
export const PAYMENT_METHODS = ["payphone", "local", "efectivo", "transferencia"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export interface ICustomerOrderItem {
  product: Types.ObjectId;
  name: string;
  qty: number;
  unitPrice: number;
  options: { name: string; choice: string; price: number }[];
  notes: string;
  lineTotal: number;
}

/** Pedido de un cliente por la tienda en línea (web o agente de WhatsApp). */
export interface ICustomerOrder {
  number: string;
  /** Código corto para el link de seguimiento. */
  trackingCode: string;
  branch: Types.ObjectId;
  branchName: string;
  type: "retiro" | "domicilio";
  channel: "web" | "whatsapp" | "agente" | "telefono";
  customer: { name: string; phone: string; email: string };
  address: { text: string; reference: string; lat: number | null; lng: number | null };
  items: ICustomerOrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  payment: { method: PaymentMethod; status: "pendiente" | "pagado" | "fallido"; reference: string; payphoneId: string; paidAt: Date | null };
  status: CustomerOrderStatus;
  notes: string;
  /** Hora pedida por el cliente (vacío = lo antes posible). */
  scheduledFor: string;
  estimatedMinutes: number;
  timeline: { status: string; at: Date; by: string; note: string }[];
  /** Ya fue ingresado al POS del local por el cajero. */
  enteredInPos: boolean;
  cancelReason: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const itemSchema = new Schema<ICustomerOrderItem>({ product: { type: Schema.Types.ObjectId, ref: "Product", required: true }, name: { type: String, required: true }, qty: { type: Number, required: true, min: 1 }, unitPrice: { type: Number, required: true }, options: { type: [{ name: String, choice: String, price: { type: Number, default: 0 } }], default: [] }, notes: { type: String, default: "" }, lineTotal: { type: Number, required: true } }, { _id: false });

const orderSchema = new Schema<ICustomerOrder>(
  {
    number: { type: String, required: true, unique: true },
    trackingCode: { type: String, required: true, unique: true },
    branch: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    branchName: { type: String, default: "" },
    type: { type: String, enum: FULFILLMENT_TYPES, required: true },
    channel: { type: String, enum: ["web", "whatsapp", "agente", "telefono"], default: "web" },
    customer: { name: { type: String, required: true, trim: true }, phone: { type: String, required: true, trim: true }, email: { type: String, default: "", trim: true } },
    address: { text: { type: String, default: "" }, reference: { type: String, default: "" }, lat: { type: Number, default: null }, lng: { type: Number, default: null } },
    items: { type: [itemSchema], default: [] },
    subtotal: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    total: { type: Number, default: 0 },
    payment: { method: { type: String, enum: PAYMENT_METHODS, default: "local" }, status: { type: String, enum: ["pendiente", "pagado", "fallido"], default: "pendiente" }, reference: { type: String, default: "" }, payphoneId: { type: String, default: "" }, paidAt: { type: Date, default: null } },
    status: { type: String, enum: CUSTOMER_ORDER_STATUSES, default: "nuevo", index: true },
    notes: { type: String, default: "" },
    scheduledFor: { type: String, default: "" },
    estimatedMinutes: { type: Number, default: 30 },
    timeline: { type: [{ status: String, at: { type: Date, default: Date.now }, by: { type: String, default: "" }, note: { type: String, default: "" } }], default: [] },
    enteredInPos: { type: Boolean, default: false },
    cancelReason: { type: String, default: "" },
  },
  { timestamps: true },
);
orderSchema.index({ createdAt: -1 });

export const CustomerOrder = (mongoose.models.CustomerOrder as mongoose.Model<ICustomerOrder>) || mongoose.model<ICustomerOrder>("CustomerOrder", orderSchema);

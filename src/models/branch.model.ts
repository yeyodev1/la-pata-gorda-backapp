import mongoose, { Schema } from "mongoose";

export const BRANCH_TYPES = ["local", "produccion", "bodega"] as const;
export type BranchType = (typeof BRANCH_TYPES)[number];

/** Un lugar físico: restaurante (local), centro de producción o bodega central. */
export interface IBranch {
  code: string;
  name: string;
  type: BranchType;
  city: string;
  address: string;
  phone: string;
  /** Capacidad para reservas (personas). */
  capacity: number;
  /** Horario "12:00-22:00". */
  hours: string;
  /** Franquicia (Ambato) o propio. */
  franchise: boolean;
  /** Orden de despacho / visual. */
  order: number;
  /** Tienda en línea */
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  deliveryFee: number;
  minOrder: number;
  /** Minutos estimados de preparación para retiro. */
  prepMinutes: number;
  whatsapp: string;
  mapsUrl: string;
  /** Mesas privadas / salones que se reservan con confirmación del administrador. */
  privateTables: { name: string; capacity: number }[];
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const branchSchema = new Schema<IBranch>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, enum: BRANCH_TYPES, default: "local" },
    city: { type: String, default: "", trim: true },
    address: { type: String, default: "", trim: true },
    phone: { type: String, default: "", trim: true },
    capacity: { type: Number, default: 0 },
    hours: { type: String, default: "12:00-22:00" },
    franchise: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    pickupEnabled: { type: Boolean, default: true },
    deliveryEnabled: { type: Boolean, default: true },
    deliveryFee: { type: Number, default: 2.5 },
    minOrder: { type: Number, default: 0 },
    prepMinutes: { type: Number, default: 25 },
    whatsapp: { type: String, default: "" },
    mapsUrl: { type: String, default: "" },
    privateTables: { type: [{ name: { type: String, required: true }, capacity: { type: Number, default: 10 } }], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Branch = (mongoose.models.Branch as mongoose.Model<IBranch>) || mongoose.model<IBranch>("Branch", branchSchema);

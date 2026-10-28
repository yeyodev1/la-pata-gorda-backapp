import mongoose, { Schema } from "mongoose";

export interface ISupplier {
  name: string;
  contact: string;
  phone: string;
  email: string;
  /** Qué provee: mariscos, granos, insumos… */
  categories: string[];
  creditDays: number;
  notes: string;
  active: boolean;
}

const supplierSchema = new Schema<ISupplier>(
  {
    name: { type: String, required: true, trim: true },
    contact: { type: String, default: "" },
    phone: { type: String, default: "" },
    email: { type: String, default: "" },
    categories: { type: [String], default: [] },
    creditDays: { type: Number, default: 0 },
    notes: { type: String, default: "" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Supplier = (mongoose.models.Supplier as mongoose.Model<ISupplier>) || mongoose.model<ISupplier>("Supplier", supplierSchema);

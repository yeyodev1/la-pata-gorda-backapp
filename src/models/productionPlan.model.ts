import mongoose, { Schema, Types } from "mongoose";

export const PLAN_STATUSES = ["borrador", "en_proceso", "cerrado"] as const;
export type PlanStatus = (typeof PLAN_STATUSES)[number];

export interface IPlanLine {
  ingredient: Types.ObjectId;
  ingredientName: string;
  unit: string;
  /** Suma de lo aprobado en los pedidos de los locales. */
  required: number;
  /** Existencia en el centro de producción. */
  stock: number;
  /** required × (1 + seguridad) − stock. */
  toProduce: number;
  produced: number;
}

export interface IRawNeed {
  ingredient: Types.ObjectId;
  ingredientName: string;
  unit: string;
  needed: number;
  stock: number;
  /** needed − stock, si falta. */
  shortage: number;
}

/** Plan de producción de un día: qué preparar para cubrir los pedidos de todos los locales. */
export interface IProductionPlan {
  number: string;
  date: string;
  status: PlanStatus;
  orders: Types.ObjectId[];
  items: IPlanLine[];
  /** Materia prima que consume lo que hay que producir, contra bodega. */
  rawNeeds: IRawNeed[];
  notes: string;
  createdBy: string;
  closedAt: Date | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const lineSchema = new Schema<IPlanLine>({ ingredient: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true }, ingredientName: String, unit: String, required: { type: Number, default: 0 }, stock: { type: Number, default: 0 }, toProduce: { type: Number, default: 0 }, produced: { type: Number, default: 0 } }, { _id: false });
const rawSchema = new Schema<IRawNeed>({ ingredient: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true }, ingredientName: String, unit: String, needed: { type: Number, default: 0 }, stock: { type: Number, default: 0 }, shortage: { type: Number, default: 0 } }, { _id: false });

const planSchema = new Schema<IProductionPlan>(
  {
    number: { type: String, required: true, unique: true },
    date: { type: String, required: true, unique: true },
    status: { type: String, enum: PLAN_STATUSES, default: "borrador" },
    orders: { type: [Schema.Types.ObjectId], default: [] },
    items: { type: [lineSchema], default: [] },
    rawNeeds: { type: [rawSchema], default: [] },
    notes: { type: String, default: "" },
    createdBy: { type: String, default: "" },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const ProductionPlan = (mongoose.models.ProductionPlan as mongoose.Model<IProductionPlan>) || mongoose.model<IProductionPlan>("ProductionPlan", planSchema);

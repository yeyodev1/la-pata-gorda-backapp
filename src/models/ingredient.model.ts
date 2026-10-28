import mongoose, { Schema, Types } from "mongoose";

export const INGREDIENT_UNITS = ["kg", "lb", "un", "lt", "porcion", "paq"] as const;
export type IngredientUnit = (typeof INGREDIENT_UNITS)[number];
export const INGREDIENT_GROUPS = ["mariscos", "preparados", "granos", "verduras", "lacteos", "carnes", "bebidas", "insumos", "otros"] as const;
export type IngredientGroup = (typeof INGREDIENT_GROUPS)[number];

export interface IRecipeLine {
  ingredient: Types.ObjectId;
  qty: number;
}

/**
 * Insumo o preparado que se controla en inventario: cangrejo, camarón, salsa criolla, arroz…
 * Los "preparados" los hace el centro de producción (tienen su propia receta de insumos).
 */
export interface IIngredient {
  code: string;
  name: string;
  group: IngredientGroup;
  unit: IngredientUnit;
  /** Costo por unidad (referencial, para valorizar). */
  cost: number;
  /** Lo produce el centro de producción (ej. cangrejo cocinado, salsa criolla). */
  producedInHouse: boolean;
  /** Receta del preparado (solo producedInHouse): insumos por 1 unidad producida. */
  recipe: IRecipeLine[];
  /** Mínimo por local antes de alertar. */
  minStock: number;
  /** Días de vida útil (0 = no perecible). */
  shelfLifeDays: number;
  supplier: Types.ObjectId | null;
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const recipeLineSchema = new Schema<IRecipeLine>({ ingredient: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true }, qty: { type: Number, required: true, min: 0 } }, { _id: false });

const ingredientSchema = new Schema<IIngredient>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    group: { type: String, enum: INGREDIENT_GROUPS, default: "otros" },
    unit: { type: String, enum: INGREDIENT_UNITS, default: "un" },
    cost: { type: Number, default: 0 },
    producedInHouse: { type: Boolean, default: false },
    recipe: { type: [recipeLineSchema], default: [] },
    minStock: { type: Number, default: 0 },
    shelfLifeDays: { type: Number, default: 0 },
    supplier: { type: Schema.Types.ObjectId, ref: "Supplier", default: null },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const Ingredient = (mongoose.models.Ingredient as mongoose.Model<IIngredient>) || mongoose.model<IIngredient>("Ingredient", ingredientSchema);

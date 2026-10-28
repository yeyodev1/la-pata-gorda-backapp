import mongoose, { Schema, Types } from "mongoose";
import { IRecipeLine } from "./ingredient.model";

export interface ICategory {
  name: string;
  order: number;
  active: boolean;
}
const categorySchema = new Schema<ICategory>({ name: { type: String, required: true, unique: true, trim: true }, order: { type: Number, default: 0 }, active: { type: Boolean, default: true } }, { timestamps: true });
export const Category = (mongoose.models.Category as mongoose.Model<ICategory>) || mongoose.model<ICategory>("Category", categorySchema);

/** Plato del menú. Su receta dice cuánto insumo/preparado consume cada venta. */
export interface IProductOption {
  name: string;
  required: boolean;
  /** Máximo de opciones elegibles (1 = selección única). */
  max: number;
  choices: { label: string; price: number }[];
}

export interface IProduct {
  code: string;
  name: string;
  category: Types.ObjectId;
  description: string;
  price: number;
  image: string;
  /** Receta: consumo de inventario por 1 plato vendido. */
  recipe: IRecipeLine[];
  featured: boolean;
  /** Opciones que elige el cliente (base, término, extras). */
  options: IProductOption[];
  /** Se muestra en la tienda en línea. */
  online: boolean;
  /** Locales donde NO se vende (por defecto en todos). */
  excludedBranches: Types.ObjectId[];
  active: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const recipeLineSchema = new Schema<IRecipeLine>({ ingredient: { type: Schema.Types.ObjectId, ref: "Ingredient", required: true }, qty: { type: Number, required: true, min: 0 } }, { _id: false });

const optionSchema = new Schema<IProductOption>({ name: { type: String, required: true }, required: { type: Boolean, default: false }, max: { type: Number, default: 1 }, choices: { type: [{ label: { type: String, required: true }, price: { type: Number, default: 0 } }], default: [] } }, { _id: false });

const productSchema = new Schema<IProduct>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    category: { type: Schema.Types.ObjectId, ref: "Category", required: true },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    image: { type: String, default: "" },
    recipe: { type: [recipeLineSchema], default: [] },
    featured: { type: Boolean, default: false },
    options: { type: [optionSchema], default: [] },
    online: { type: Boolean, default: true },
    excludedBranches: { type: [Schema.Types.ObjectId], default: [] },
    active: { type: Boolean, default: true },
  },
  { timestamps: true },
);
productSchema.index({ name: "text", description: "text" });

export const Product = (mongoose.models.Product as mongoose.Model<IProduct>) || mongoose.model<IProduct>("Product", productSchema);

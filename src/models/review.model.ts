import mongoose, { Schema, Types } from "mongoose";

/** Reseña de Google (u otra fuente) de un local, con su respuesta. */
export interface IReview {
  branch: Types.ObjectId | null;
  branchName: string;
  source: "google" | "tripadvisor" | "instagram" | "otro";
  externalId: string;
  author: string;
  rating: number;
  text: string;
  reviewedAt: Date;
  reply: string;
  repliedBy: string;
  repliedAt: Date | null;
  status: "nueva" | "respondida" | "escalada";
  createdAt?: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    branch: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    branchName: { type: String, default: "" },
    source: { type: String, enum: ["google", "tripadvisor", "instagram", "otro"], default: "google" },
    externalId: { type: String, default: "" },
    author: { type: String, default: "" },
    rating: { type: Number, min: 1, max: 5, required: true },
    text: { type: String, default: "" },
    reviewedAt: { type: Date, default: Date.now },
    reply: { type: String, default: "" },
    repliedBy: { type: String, default: "" },
    repliedAt: { type: Date, default: null },
    status: { type: String, enum: ["nueva", "respondida", "escalada"], default: "nueva", index: true },
  },
  { timestamps: true },
);
reviewSchema.index({ source: 1, externalId: 1 });

export const Review = (mongoose.models.Review as mongoose.Model<IReview>) || mongoose.model<IReview>("Review", reviewSchema);

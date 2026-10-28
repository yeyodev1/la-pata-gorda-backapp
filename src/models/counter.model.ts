import mongoose, { Schema } from "mongoose";

const counterSchema = new Schema({ _id: String, seq: { type: Number, default: 0 } });
const Counter = (mongoose.models.Counter as mongoose.Model<{ _id: string; seq: number }>) || mongoose.model("Counter", counterSchema);

/** Número correlativo por prefijo: PED-000123, PLAN-000004, COM-000010, RES-000050. */
export async function nextNumber(prefix: string): Promise<string> {
  const doc = await Counter.findByIdAndUpdate(prefix, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${prefix}-${String(doc!.seq).padStart(6, "0")}`;
}

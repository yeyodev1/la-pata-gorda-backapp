import mongoose, { Schema, Types } from "mongoose";

/** Bitácora: quién hizo qué, cuándo y sobre qué (regla de oro: todo queda registrado con motivo). */
export interface IAuditEvent {
  user: Types.ObjectId | null;
  userName: string;
  role: string;
  action: string;
  entityType: string;
  entityId: Types.ObjectId | null;
  entityLabel: string;
  detail: unknown;
  at: Date;
}

const auditSchema = new Schema<IAuditEvent>({
  user: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  userName: { type: String, default: "" },
  role: { type: String, default: "" },
  action: { type: String, required: true, index: true },
  entityType: { type: String, default: "", index: true },
  entityId: { type: Schema.Types.ObjectId, default: null },
  entityLabel: { type: String, default: "" },
  detail: { type: Schema.Types.Mixed, default: null },
  at: { type: Date, default: Date.now, index: true },
});

export const AuditEvent = (mongoose.models.AuditEvent as mongoose.Model<IAuditEvent>) || mongoose.model<IAuditEvent>("AuditEvent", auditSchema);

import mongoose, { Schema, Types } from "mongoose";

export const ALERT_TYPES = ["pedido_inflado", "stock_critico", "diferencia_inventario", "pedido_sin_enviar", "ventas_sin_cerrar", "materia_prima_faltante", "reserva_sin_confirmar", "resena_negativa", "conversacion_sin_responder", "otro"] as const;
export type AlertType = (typeof ALERT_TYPES)[number];

export interface IAlert {
  type: AlertType;
  severity: "info" | "warning" | "critical";
  title: string;
  body: string;
  branch: Types.ObjectId | null;
  branchName: string;
  /** Roles a los que les toca atenderla. */
  audience: string[];
  refType: string;
  refId: Types.ObjectId | null;
  /** Llave para no duplicar la misma alerta cada noche. */
  key: string;
  status: "abierta" | "atendida" | "descartada";
  resolvedBy: string;
  resolvedAt: Date | null;
  note: string;
  createdAt?: Date;
}

const alertSchema = new Schema<IAlert>(
  {
    type: { type: String, enum: ALERT_TYPES, required: true },
    severity: { type: String, enum: ["info", "warning", "critical"], default: "warning" },
    title: { type: String, required: true },
    body: { type: String, default: "" },
    branch: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    branchName: { type: String, default: "" },
    audience: { type: [String], default: [] },
    refType: { type: String, default: "" },
    refId: { type: Schema.Types.ObjectId, default: null },
    key: { type: String, default: "", index: true },
    status: { type: String, enum: ["abierta", "atendida", "descartada"], default: "abierta", index: true },
    resolvedBy: { type: String, default: "" },
    resolvedAt: { type: Date, default: null },
    note: { type: String, default: "" },
  },
  { timestamps: true },
);

export const Alert = (mongoose.models.Alert as mongoose.Model<IAlert>) || mongoose.model<IAlert>("Alert", alertSchema);

/** Crea la alerta solo si no hay otra abierta con la misma llave. */
export async function raiseAlert(data: Partial<IAlert> & { type: AlertType; title: string; key: string }) {
  const existing = await Alert.findOne({ key: data.key, status: "abierta" });
  if (existing) return existing;
  return Alert.create(data);
}

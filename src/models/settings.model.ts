import mongoose, { Schema } from "mongoose";

/** Parámetros del negocio, editables por gerencia. */
export interface ISettings {
  key: string;
  /** % de stock de seguridad sobre el consumo esperado (20 = 20 %). */
  safetyStockPct: number;
  /** Semanas hacia atrás para el promedio por día de semana. */
  weeksForAverage: number;
  /** Si el local pide más de este % sobre lo sugerido, se marca como inflado. */
  inflatedThresholdPct: number;
  /** Diferencia de inventario (en % del esperado) que dispara alerta. */
  countDiffAlertPct: number;
  /** Hora límite para enviar el pedido del día siguiente (HH:MM). */
  orderCutoff: string;
  /** Duración de una mesa para calcular capacidad de reservas (min). */
  reservationSlotMin: number;
  whatsappNumber: string;
  assistantName: string;
}

const settingsSchema = new Schema<ISettings>({
  key: { type: String, default: "global", unique: true },
  safetyStockPct: { type: Number, default: 20 },
  weeksForAverage: { type: Number, default: 4 },
  inflatedThresholdPct: { type: Number, default: 25 },
  countDiffAlertPct: { type: Number, default: 10 },
  orderCutoff: { type: String, default: "15:00" },
  reservationSlotMin: { type: Number, default: 90 },
  whatsappNumber: { type: String, default: "" },
  assistantName: { type: String, default: "Gordo" },
});

export const Settings = (mongoose.models.Settings as mongoose.Model<ISettings>) || mongoose.model<ISettings>("Settings", settingsSchema);

export async function getSettings(): Promise<ISettings> {
  const s = await Settings.findOne({ key: "global" });
  if (s) return s;
  return Settings.create({ key: "global" });
}

import mongoose, { Schema, Types } from "mongoose";

export const RESERVATION_STATUSES = ["pendiente", "confirmada", "sentada", "cancelada", "no_show"] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];
export const CHANNELS = ["whatsapp", "telefono", "web", "agente", "local"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Reserva de mesa en un local. Entra por WhatsApp (agente o persona), teléfono o web. */
export interface IReservation {
  number: string;
  branch: Types.ObjectId;
  branchName: string;
  date: string;
  time: string; // HH:MM
  name: string;
  phone: string;
  people: number;
  status: ReservationStatus;
  channel: Channel;
  notes: string;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const reservationSchema = new Schema<IReservation>(
  {
    number: { type: String, required: true, unique: true },
    branch: { type: Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    branchName: { type: String, default: "" },
    date: { type: String, required: true, index: true },
    time: { type: String, required: true },
    name: { type: String, required: true, trim: true },
    phone: { type: String, default: "", trim: true },
    people: { type: Number, required: true, min: 1 },
    status: { type: String, enum: RESERVATION_STATUSES, default: "pendiente" },
    channel: { type: String, enum: CHANNELS, default: "whatsapp" },
    notes: { type: String, default: "" },
    createdBy: { type: String, default: "" },
  },
  { timestamps: true },
);

export const Reservation = (mongoose.models.Reservation as mongoose.Model<IReservation>) || mongoose.model<IReservation>("Reservation", reservationSchema);

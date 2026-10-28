import { Types } from "mongoose";
import { Reservation, RESERVATION_STATUSES, CHANNELS } from "../models/reservation.model";
import { Branch } from "../models/branch.model";
import { getSettings } from "../models/settings.model";
import { nextNumber } from "../models/counter.model";
import { badRequest, notFound } from "../errors/httpError";
import { h, str } from "../utils/handler";
import { num } from "../utils/numbers";
import { pageQuery, paged } from "../utils/pagination";
import { ecuadorDateString } from "../utils/dates";
import { audit } from "../services/audit.service";
import { assertBranchAccess } from "./catalog.controller";

/** Personas ya reservadas en la franja (±slot) para ver disponibilidad. */
async function occupancy(branch: Types.ObjectId, date: string, time: string, slotMin: number, excludeId?: Types.ObjectId) {
  const [h, m] = time.split(":").map(Number);
  const t = (h ?? 0) * 60 + (m ?? 0);
  const docs = await Reservation.find({ branch, date, status: { $in: ["pendiente", "confirmada", "sentada"] }, ...(excludeId ? { _id: { $ne: excludeId } } : {}) });
  return docs.filter((r) => { const [rh, rm] = r.time.split(":").map(Number); const rt = (rh ?? 0) * 60 + (rm ?? 0); return Math.abs(rt - t) < slotMin; }).reduce((a, r) => a + r.people, 0);
}

export const availability = h(async (req, res) => {
  const branchId = String(req.query.branch ?? "");
  const date = String(req.query.date ?? ecuadorDateString());
  if (!branchId) throw badRequest("Indica el local");
  const branch = await Branch.findById(branchId);
  if (!branch) throw notFound("Local no encontrado");
  const settings = await getSettings();
  const [open, close] = branch.hours.split("-");
  const [oh] = (open ?? "12:00").split(":").map(Number);
  const [ch] = (close ?? "22:00").split(":").map(Number);
  const slots = [];
  for (let hh = oh ?? 12; hh < (ch ?? 22); hh++) for (const mm of ["00", "30"]) {
    const time = `${String(hh).padStart(2, "0")}:${mm}`;
    const used = await occupancy(branch._id, date, time, settings.reservationSlotMin);
    slots.push({ time, used, free: Math.max(0, branch.capacity - used) });
  }
  res.json({ branch: { id: branch._id, name: branch.name, capacity: branch.capacity, hours: branch.hours }, date, slots });
});

export const listReservations = h(async (req, res) => {
  const q = pageQuery(req, 100);
  const filter: Record<string, unknown> = {};
  const branchId = req.query.branch ? String(req.query.branch) : req.auth!.role === "local" ? req.auth!.branch : null;
  if (branchId) { assertBranchAccess(req.auth, branchId); filter.branch = new Types.ObjectId(branchId); }
  if (req.query.date) filter.date = String(req.query.date);
  if (req.query.from || req.query.to) filter.date = { ...(req.query.from ? { $gte: String(req.query.from) } : {}), ...(req.query.to ? { $lte: String(req.query.to) } : {}) };
  if (req.query.status) filter.status = { $in: String(req.query.status).split(",") };
  if (req.query.q) filter.$or = [{ name: { $regex: String(req.query.q), $options: "i" } }, { phone: { $regex: String(req.query.q), $options: "i" } }];
  const [items, total] = await Promise.all([Reservation.find(filter).sort({ date: 1, time: 1 }).skip(q.skip).limit(q.limit), Reservation.countDocuments(filter)]);
  res.json(paged(items, total, q));
});

export const createReservation = h(async (req, res) => {
  const { branch, date, time, name, phone, people, channel, notes } = req.body;
  if (!branch || !date || !time || !name || !people) throw badRequest("Local, fecha, hora, nombre y personas son obligatorios");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) throw badRequest("Fecha u hora inválida");
  const b = await Branch.findById(branch);
  if (!b || b.type !== "local") throw badRequest("Local inválido");
  const settings = await getSettings();
  const used = await occupancy(b._id, date, time, settings.reservationSlotMin);
  const free = Math.max(0, b.capacity - used);
  if (b.capacity > 0 && num(people) > free) throw badRequest(`No hay cupo a esa hora en ${b.name}: quedan ${free} lugares`, { free });
  const r = await Reservation.create({ number: await nextNumber("RES"), branch: b._id, branchName: b.name, date, time, name: str(name), phone: str(phone), people: num(people), status: req.body.status && RESERVATION_STATUSES.includes(req.body.status) ? req.body.status : "pendiente", channel: CHANNELS.includes(channel) ? channel : "whatsapp", notes: str(notes), createdBy: req.auth?.name ?? "agente" });
  await audit(req.auth, "crear_reserva", { type: "Reservation", id: r._id, label: r.number }, { branch: b.name, date, time, people: r.people });
  res.status(201).json({ reservation: r });
});

export const updateReservation = h(async (req, res) => {
  const r = await Reservation.findById(req.params.id);
  if (!r) throw notFound("Reserva no encontrada");
  assertBranchAccess(req.auth, String(r.branch));
  const b = req.body;
  if (b.status !== undefined) { if (!RESERVATION_STATUSES.includes(b.status)) throw badRequest("Estado inválido"); r.status = b.status; }
  for (const k of ["date", "time", "name", "phone", "notes"] as const) if (b[k] !== undefined) r[k] = str(b[k]);
  if (b.people !== undefined) r.people = num(b.people);
  if (b.branch !== undefined) { const nb = await Branch.findById(b.branch); if (!nb) throw badRequest("Local inválido"); r.branch = nb._id; r.branchName = nb.name; }
  await r.save();
  await audit(req.auth, "editar_reserva", { type: "Reservation", id: r._id, label: r.number }, { status: r.status });
  res.json({ reservation: r });
});

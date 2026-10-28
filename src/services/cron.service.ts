import { Branch } from "../models/branch.model";
import { DailySales } from "../models/dailySales.model";
import { InternalOrder } from "../models/internalOrder.model";
import { Reservation } from "../models/reservation.model";
import { Conversation } from "../models/conversation.model";
import { StockLevel } from "../models/stock.model";
import { Ingredient } from "../models/ingredient.model";
import { raiseAlert } from "../models/alert.model";
import { ecuadorDateString, addDaysStr } from "../utils/dates";

/**
 * Cierre diario (01:00 Ecuador): revisa lo que quedó pendiente y levanta alertas.
 * - Locales sin cierre de ventas de ayer.
 * - Locales sin pedido enviado para hoy.
 * - Stock por debajo del mínimo (locales y producción).
 * - Reservas de hoy sin confirmar.
 * - Conversaciones de WhatsApp abiertas sin respuesta hace más de 2 horas.
 */
export async function runDailyCron() {
  const today = ecuadorDateString();
  const yesterday = addDaysStr(today, -1);
  const branches = await Branch.find({ type: "local", active: true });
  let alerts = 0;
  for (const b of branches) {
    const sales = await DailySales.findOne({ branch: b._id, date: yesterday });
    if (!sales) { await raiseAlert({ type: "ventas_sin_cerrar", severity: "warning", title: `${b.name} no cerró ventas del ${yesterday}`, body: "Sin el cierre de ventas el inventario y la sugerencia de pedido quedan desactualizados.", branch: b._id, branchName: b.name, audience: ["local", "gerencia"], key: `ventas:${b._id}:${yesterday}` }); alerts++; }
    const order = await InternalOrder.findOne({ branch: b._id, deliveryDate: today, status: { $in: ["enviado", "aprobado", "despachado", "recibido"] } });
    if (!order) { await raiseAlert({ type: "pedido_sin_enviar", severity: "warning", title: `${b.name} no envió pedido para hoy ${today}`, body: "Producción no recibió pedido de este local.", branch: b._id, branchName: b.name, audience: ["local", "produccion", "gerencia"], key: `pedido:${b._id}:${today}` }); alerts++; }
  }
  // Solo lo crítico para la operación (mariscos y preparados); el resto se ve en Inventario sin alertar.
  const ingredients = await Ingredient.find({ active: true, minStock: { $gt: 0 }, group: { $in: ["mariscos", "preparados"] } });
  const ingById = new Map(ingredients.map((i) => [String(i._id), i]));
  const levels = await StockLevel.find({ ingredient: { $in: ingredients.map((i) => i._id) } }).populate("branch", "name type active");
  for (const l of levels) {
    const ing = ingById.get(String(l.ingredient));
    const b = l.branch as unknown as { _id: unknown; name: string; active: boolean } | null;
    if (!ing || !b || !b.active || l.qty >= ing.minStock || (b as { type?: string }).type !== "local") continue;
    await raiseAlert({ type: "stock_critico", severity: l.qty <= 0 ? "critical" : "warning", title: `${ing.name} bajo mínimo en ${b.name}`, body: `Hay ${l.qty} ${ing.unit}; el mínimo es ${ing.minStock}.`, branch: b._id as never, branchName: b.name, audience: ["local", "produccion", "bodega", "compras"], key: `stock:${String(b._id)}:${ing._id}:${today}` });
    alerts++;
  }
  const pend = await Reservation.find({ date: today, status: "pendiente" });
  for (const r of pend) { await raiseAlert({ type: "reserva_sin_confirmar", severity: "info", title: `Reserva de ${r.name} hoy ${r.time} sin confirmar (${r.branchName})`, body: `${r.people} personas · ${r.phone}`, branch: r.branch, branchName: r.branchName, audience: ["atencion", "local"], refType: "Reservation", refId: r._id, key: `reserva:${r._id}` }); alerts++; }
  const stale = await Conversation.find({ status: "abierta", unread: { $gt: 0 }, lastMessageAt: { $lt: new Date(Date.now() - 2 * 3600000) } });
  for (const c of stale) { await raiseAlert({ type: "conversacion_sin_responder", severity: "warning", title: `WhatsApp sin responder: ${c.name || c.phone}`, body: c.lastText.slice(0, 120), audience: ["atencion", "gerencia"], refType: "Conversation", refId: c._id, key: `conv:${c._id}:${today}` }); alerts++; }
  return { date: today, alerts };
}

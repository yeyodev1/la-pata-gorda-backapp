import Anthropic from "@anthropic-ai/sdk";
import { Types } from "mongoose";
import { env } from "../config/env";
import { Branch } from "../models/branch.model";
import { DailySales } from "../models/dailySales.model";
import { InternalOrder } from "../models/internalOrder.model";
import { Reservation } from "../models/reservation.model";
import { Alert } from "../models/alert.model";
import { StockLevel } from "../models/stock.model";
import { Ingredient } from "../models/ingredient.model";
import { Review } from "../models/review.model";
import { getSettings } from "../models/settings.model";
import { ecuadorDateString, addDaysStr, WEEKDAY_LABELS, weekdayOf } from "../utils/dates";
import { round2 } from "../utils/numbers";
import { suggestOrder } from "./forecast.service";
import { AuthPayload } from "../middlewares/auth.middleware";

/**
 * Arma el "estado del negocio" que el asistente usa para responder: ventas recientes por local,
 * pedidos del día, stock bajo, reservas de hoy y mañana, alertas abiertas y reseñas pendientes.
 * Para un administrador de local solo incluye su local.
 */
export async function businessSnapshot(auth: AuthPayload | undefined): Promise<string> {
  const today = ecuadorDateString();
  const tomorrow = addDaysStr(today, 1);
  const branchFilter: Record<string, unknown> = auth?.role === "local" && auth.branch ? { _id: new Types.ObjectId(auth.branch) } : { type: "local" };
  const branches = await Branch.find({ ...branchFilter, active: true }).sort({ order: 1 });
  const bIds = branches.map((b) => b._id);
  const since = addDaysStr(today, -7);
  const sales = await DailySales.find({ branch: { $in: bIds }, date: { $gte: since } });
  const orders = await InternalOrder.find({ branch: { $in: bIds }, deliveryDate: { $in: [today, tomorrow] }, status: { $ne: "anulado" } });
  const reservations = await Reservation.find({ branch: { $in: bIds }, date: { $in: [today, tomorrow] }, status: { $in: ["pendiente", "confirmada"] } });
  const alerts = await Alert.find({ status: "abierta", ...(auth?.role === "local" && auth.branch ? { branch: new Types.ObjectId(auth.branch) } : {}) }).sort({ severity: -1 }).limit(15);
  const reviews = await Review.find({ status: "nueva" }).sort({ reviewedAt: -1 }).limit(5);
  const ingredients = await Ingredient.find({ active: true });
  const ingById = new Map(ingredients.map((i) => [String(i._id), i]));
  const levels = await StockLevel.find({ branch: { $in: bIds } });
  const lines: string[] = [];
  lines.push(`Hoy es ${today} (${WEEKDAY_LABELS[weekdayOf(today)]}). Mañana ${tomorrow} (${WEEKDAY_LABELS[weekdayOf(tomorrow)]}).`);
  for (const b of branches) {
    const s = sales.filter((x) => String(x.branch) === String(b._id));
    const total = round2(s.reduce((a, x) => a + x.totalAmount, 0));
    const todaySales = s.find((x) => x.date === today);
    lines.push(`\n## ${b.name} (${b.city})`);
    lines.push(`Ventas últimos 7 días: $${total} en ${s.length} día(s) cerrados.${todaySales ? ` Hoy: $${todaySales.totalAmount}.` : " Hoy aún sin cierre de ventas."}`);
    const top = new Map<string, number>();
    for (const x of s) for (const it of x.items) top.set(it.productName, (top.get(it.productName) ?? 0) + it.qty);
    const topList = [...top.entries()].sort((a, c) => c[1] - a[1]).slice(0, 5).map(([n, q]) => `${n} (${q})`).join(", ");
    if (topList) lines.push(`Más vendidos: ${topList}.`);
    const o = orders.filter((x) => String(x.branch) === String(b._id));
    lines.push(o.length ? `Pedidos a producción: ${o.map((x) => `${x.number} para ${x.deliveryDate} (${x.status}${x.inflatedCount ? `, ${x.inflatedCount} línea(s) por encima de lo sugerido` : ""})`).join("; ")}.` : "Sin pedido a producción para hoy ni mañana.");
    const low = levels.filter((l) => String(l.branch) === String(b._id)).map((l) => ({ l, ing: ingById.get(String(l.ingredient)) })).filter((x) => x.ing && x.ing.minStock > 0 && x.l.qty < x.ing.minStock);
    if (low.length) lines.push(`Stock bajo: ${low.map((x) => `${x.ing!.name} ${x.l.qty} ${x.ing!.unit} (mín ${x.ing!.minStock})`).join(", ")}.`);
    const r = reservations.filter((x) => String(x.branch) === String(b._id));
    if (r.length) lines.push(`Reservas: ${r.map((x) => `${x.date} ${x.time} ${x.name} ${x.people}p (${x.status})`).join("; ")}.`);
    try {
      const sug = await suggestOrder(b._id, tomorrow);
      const needed = sug.lines.filter((l) => l.suggested > 0).slice(0, 8);
      if (needed.length) lines.push(`Sugerencia de pedido para mañana (promedio de ${sug.basedOnDays} ${WEEKDAY_LABELS[sug.weekday]}s + ${sug.safetyPct}% seguridad): ${needed.map((l) => `${l.ingredientName} ${l.suggested} ${l.unit} (tiene ${l.stock}, necesita ${l.expected})`).join("; ")}.`);
    } catch { /* sin producción configurada */ }
  }
  if (alerts.length) lines.push(`\n## Alertas abiertas\n${alerts.map((a) => `- [${a.severity}] ${a.title}: ${a.body}`).join("\n")}`);
  if (reviews.length && auth?.role !== "local") lines.push(`\n## Reseñas sin responder\n${reviews.map((r) => `- ${r.rating}★ ${r.author} (${r.branchName}): "${r.text.slice(0, 140)}"`).join("\n")}`);
  return lines.join("\n");
}

export function assistantConfigured(): boolean {
  return Boolean(env.ANTHROPIC_API_KEY);
}

/** Respuesta del asistente. Con clave de Anthropic usa Claude; sin clave, devuelve el estado del negocio en texto. */
export async function askAssistant(auth: AuthPayload | undefined, question: string, history: { role: "user" | "assistant"; text: string }[] = []): Promise<{ answer: string; engine: "claude" | "reglas" }> {
  const settings = await getSettings();
  const snapshot = await businessSnapshot(auth);
  if (!assistantConfigured()) {
    return { answer: `Aún no tengo conectada la IA (falta ANTHROPIC_API_KEY en el servidor). Esto es lo que sé del negocio ahora mismo:\n\n${snapshot}`, engine: "reglas" };
  }
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const system = [
    `Eres ${settings.assistantName}, el asistente interno de La Pata Gorda, cadena ecuatoriana de restaurantes de cangrejo y mariscos (Guayaquil, Samborondón, Quito, Manta, Ambato y Miami).`,
    `Hablas con ${auth?.name ?? "una persona del equipo"} (rol: ${auth?.role ?? "desconocido"}). Responde en español, directo y corto, con números concretos. No inventes datos: si algo no está en el estado del negocio, dilo.`,
    "Tu trabajo: ayudar a decidir cuánto pedir y producir, detectar locales que piden de más, stock bajo, ventas por día de semana, reservas y reseñas. Cuando des una recomendación de pedido o producción, explica el cálculo en una línea (promedio del día de semana × seguridad − existencia).",
  ].join("\n");
  const messages: Anthropic.MessageParam[] = [
    ...history.slice(-10).map((h) => ({ role: h.role, content: h.text }) as Anthropic.MessageParam),
    { role: "user", content: `Estado del negocio:\n${snapshot}\n\nPregunta: ${question}` },
  ];
  const response = await client.beta.messages.create({
    model: env.ANTHROPIC_MODEL,
    max_tokens: 2048,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low" },
    system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
    messages,
  });
  if (response.stop_reason === "refusal") return { answer: "No puedo responder eso. Pregúntame sobre ventas, pedidos, producción, inventario, reservas o reseñas.", engine: "claude" };
  const answer = response.content.filter((b) => b.type === "text").map((b) => b.text).join("\n").trim();
  return { answer: answer || "Sin respuesta.", engine: "claude" };
}

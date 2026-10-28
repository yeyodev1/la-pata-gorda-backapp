import mongoose from "mongoose";
import { env } from "./env";

let lastOk = 0;

export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/** Conexión tolerante a serverless: reutiliza la conexión viva si existe. */
export async function dbConnect(): Promise<boolean> {
  if (isConnected()) return false;
  if (!env.MONGODB_URI) throw new Error("Falta MONGODB_URI (secreto de Cloudflare o variable en .env)");
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000, maxIdleTimeMS: 120000, heartbeatFrequencyMS: 15000, maxPoolSize: 5 });
  lastOk = Date.now();
  return true;
}

/**
 * Garantiza que la conexión sirve: si lleva más de 15 s sin usarse hace un ping; si el socket fue
 * cerrado por Atlas ("Connection was force closed"), cierra y vuelve a conectar.
 */
export async function ensureAlive(): Promise<void> {
  if (!isConnected()) { await dbConnect(); return; }
  if (Date.now() - lastOk < 15000) return;
  try {
    await Promise.race([mongoose.connection.db!.command({ ping: 1 }), new Promise((_, rej) => setTimeout(() => rej(new Error("ping timeout")), 4000))]);
    lastOk = Date.now();
  } catch (err) {
    console.warn("[mongo] conexión muerta, reconectando:", err instanceof Error ? err.message : err);
    await resetDbForNewContext();
    await dbConnect();
  }
}

export function markDbOk() { lastOk = Date.now(); }

/** ¿El error es de socket cerrado / red? Entonces hay que reconectar en la siguiente petición. */
export function isNetworkError(err: unknown): boolean {
  const m = err instanceof Error ? `${err.name} ${err.message}` : String(err);
  return /force closed|connection .*closed|MongoNetworkError|MongoServerSelectionError|topology was destroyed|ECONNRESET|socket hang up/i.test(m);
}

/**
 * Cierra una conexión heredada de otro contexto de ejecución (Cloudflare Durable Object recreado).
 * No espera más de un segundo: si el socket viejo no responde, se abandona y `dbConnect` abre otro.
 */
export async function resetDbForNewContext(): Promise<void> {
  lastOk = 0;
  if (mongoose.connection.readyState === 0) return;
  await Promise.race([mongoose.connection.close(true).catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
}

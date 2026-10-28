import mongoose from "mongoose";
import { env } from "./env";

export function isConnected(): boolean {
  return mongoose.connection.readyState === 1;
}

/** Conexión tolerante a serverless: reutiliza la conexión viva si existe. */
export async function dbConnect(): Promise<boolean> {
  if (isConnected()) return false;
  if (!env.MONGODB_URI) throw new Error("Falta MONGODB_URI (secreto de Cloudflare o variable en .env)");
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 8000 });
  return true;
}

/**
 * Cierra una conexión heredada de otro contexto de ejecución (Cloudflare Durable Object recreado).
 * No espera más de un segundo: si el socket viejo no responde, se abandona y `dbConnect` abre otro.
 */
export async function resetDbForNewContext(): Promise<void> {
  if (mongoose.connection.readyState === 0) return;
  await Promise.race([mongoose.connection.close(true).catch(() => undefined), new Promise((r) => setTimeout(r, 1000))]);
}

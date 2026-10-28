import dotenv from "dotenv";

dotenv.config();


export const env = {
  NODE_ENV: process.env.NODE_ENV ?? "development",
  PORT: Number(process.env.PORT ?? 8400),
  /** Se valida al conectar (en Workers los secretos llegan como bindings; no romper al importar). */
  get MONGODB_URI(): string { return process.env.MONGODB_URI ?? ""; },
  get JWT_SECRET(): string { return process.env.JWT_SECRET ?? "la-pata-gorda-dev-secret-cambiar-en-produccion"; },
  JWT_EXPIRES_IN: process.env.JWT_EXPIRES_IN ?? "12h",
  CORS_ORIGINS: (process.env.CORS_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean),
  PUBLIC_APP_URL: process.env.PUBLIC_APP_URL ?? "http://localhost:5190",
  /** Clave que autoriza las rutas internas (/internal/*). */
  CRON_KEY: process.env.CRON_KEY ?? "",
  /** Asistente con Claude. Vacío = respuestas por reglas, sin IA. */
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY ?? "",
  ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5",
  /** Payphone (pasarela de pago, Ecuador). Vacío = la tienda solo ofrece pago en local / al recibir. */
  PAYPHONE_TOKEN: process.env.PAYPHONE_TOKEN ?? "",
  PAYPHONE_STORE_ID: process.env.PAYPHONE_STORE_ID ?? "",
  /** URL pública de la tienda (para el retorno de Payphone y los links de seguimiento). */
  SHOP_URL: process.env.SHOP_URL ?? process.env.PUBLIC_APP_URL ?? "http://localhost:5190",
  /** Google Maps: mapa del checkout (la tienda recibe la clave desde /public/storefront). */
  GOOGLE_MAPS_API_KEY: process.env.GOOGLE_MAPS_API_KEY ?? "",
  /** Cloudinary: fotos del menú (el navegador sube directo; la API solo firma). */
  CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME ?? "",
  CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY ?? "",
  CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET ?? "",
};

import express from "express";
import cors from "cors";
import http from "http";
import routerApi from "./routes";
import { env } from "./config/env";
import { dbConnect, isConnected } from "./config/mongo";
import { globalErrorHandler } from "./middlewares/globalErrorHandler.middleware";
import { secureHeaders } from "./middlewares/security.middleware";
import { requireInternalKey } from "./middlewares/auth.middleware";
import { cronDaily } from "./controllers/misc.controller";

const whitelist = ["http://localhost:5173", "http://localhost:5190", "http://127.0.0.1:5173", "http://127.0.0.1:5190", ...env.CORS_ORIGINS];
const allowedPatterns: RegExp[] = [/^https:\/\/[a-z0-9-]+\.vercel\.app$/i, /^https:\/\/[a-z0-9-]+\.bakano\.ec$/i, /^https:\/\/[a-z0-9-]+\.bakanoagency\.workers\.dev$/i, /^https:\/\/([a-z0-9-]+\.)?lapatagorda\.(com|ec|com\.ec)$/i, /^http:\/\/(192\.168|10\.)\d*\.\d+\.\d+:\d+$/];

function isOriginAllowed(origin: string): boolean {
  return whitelist.includes(origin) || allowedPatterns.some((p) => p.test(origin));
}

export interface CreateAppOptions {
  /** Conecta a Mongo en la primera petición (Workers / serverless). */
  lazyDb?: boolean;
}

export function createApp(options: CreateAppOptions = {}) {
  const app = express();
  app.use(cors({ origin: (origin, callback) => { if (!origin || isOriginAllowed(origin)) callback(null, true); else callback(new Error("Not allowed by CORS")); }, credentials: true }));
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(secureHeaders);
  app.use(express.json({ limit: "5mb" }));
  app.get("/", (_req, res) => { res.send("La Pata Gorda API viva"); });
  // Chequeo de vida sin tocar la base (sirve para ver si falta el acceso de red en Atlas).
  app.get("/api/health", (_req, res) => { res.json({ ok: true, db: isConnected(), assistant: Boolean(env.ANTHROPIC_API_KEY), media: Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET), time: new Date().toISOString() }); });
  if (options.lazyDb) app.use((_req, _res, next) => { dbConnect().then(() => next(), next); });
  app.post("/internal/cron/daily", requireInternalKey, cronDaily);
  routerApi(app);
  app.use(globalErrorHandler);
  const server = http.createServer(app);
  return { app, server };
}

import { NextFunction, Request, Response } from "express";
import { HttpError } from "../errors/httpError";

/** Cabeceras seguras mínimas (equivalente ligero a helmet). */
export function secureHeaders(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  res.removeHeader("X-Powered-By");
  next();
}

/** Límite de intentos por IP para rutas sensibles (login): 10 intentos cada 10 minutos. */
const attempts = new Map<string, { count: number; resetAt: number }>();
export function rateLimit(max = 10, windowMs = 10 * 60 * 1000) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = `${req.ip}|${req.path}`;
    const now = Date.now();
    const entry = attempts.get(key);
    if (!entry || entry.resetAt < now) {
      attempts.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return next(new HttpError(429, "Demasiados intentos. Espera unos minutos e inténtalo de nuevo."));
    next();
  };
}

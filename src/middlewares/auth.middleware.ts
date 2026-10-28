import { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { unauthorized, forbidden } from "../errors/httpError";
import { UserRole } from "../utils/roles";

export interface AuthPayload {
  sub: string;
  name: string;
  role: UserRole;
  /** Local asignado (solo rol local). */
  branch: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthPayload;
    }
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    next(unauthorized("Sesión requerida"));
    return;
  }
  try {
    req.auth = jwt.verify(header.slice(7), env.JWT_SECRET) as AuthPayload;
    next();
  } catch {
    next(unauthorized("Sesión caducada o inválida"));
  }
}

/** admin y gerencia pasan siempre; el resto solo si su rol está en la lista. */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(unauthorized());
    if (req.auth.role === "admin" || req.auth.role === "gerencia" || roles.includes(req.auth.role)) return next();
    next(forbidden());
  };
}

/** Clave interna para cron e integraciones (x-internal-key). */
export function requireInternalKey(req: Request, _res: Response, next: NextFunction) {
  const key = String(req.headers["x-internal-key"] ?? req.headers["x-cron-key"] ?? "");
  if (!env.CRON_KEY || key !== env.CRON_KEY) return next(forbidden("Clave interna inválida"));
  next();
}

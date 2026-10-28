import { NextFunction, Request, Response } from "express";

type Handler = (req: Request, res: Response) => Promise<unknown>;

/** Envuelve un controlador async: lo que lance va al globalErrorHandler. */
export const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

export function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

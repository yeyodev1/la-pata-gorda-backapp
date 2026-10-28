import { NextFunction, Request, Response } from "express";
import mongoose from "mongoose";
import { HttpError } from "../errors/httpError";
import { isNetworkError, resetDbForNewContext } from "../config/mongo";

export function globalErrorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof HttpError) {
    res.status(err.status).json({ message: err.message, details: err.details });
    return;
  }
  if (err instanceof mongoose.Error.ValidationError) {
    res.status(400).json({ message: "Datos inválidos", details: Object.values(err.errors).map((e) => e.message) });
    return;
  }
  if (err instanceof mongoose.Error.CastError) {
    res.status(400).json({ message: `Identificador inválido: ${err.value}` });
    return;
  }
  if (typeof err === "object" && err && (err as { code?: number }).code === 11000) {
    res.status(409).json({ message: "Ya existe un registro con ese valor único", details: (err as { keyValue?: unknown }).keyValue });
    return;
  }
  if (isNetworkError(err)) {
    // Socket a Mongo cerrado por el proveedor: se descarta la conexión para que la siguiente petición reconecte.
    void resetDbForNewContext();
    res.status(503).json({ message: "La base de datos se reconectó. Intenta de nuevo." });
    return;
  }
  console.error("[error no controlado]", err);
  res.status(500).json({ message: "Error interno del servidor" });
}

import { Types } from "mongoose";
import { AuditEvent } from "../models/auditEvent.model";
import { AuthPayload } from "../middlewares/auth.middleware";

/** Bitácora: todo queda registrado con quién, qué y sobre qué. Nunca rompe la operación. */
export async function audit(
  auth: AuthPayload | undefined,
  action: string,
  entity: { type: string; id?: Types.ObjectId | string | null; label?: string },
  detail: unknown = null,
) {
  try {
    await AuditEvent.create({
      user: auth?.sub ? new Types.ObjectId(auth.sub) : null,
      userName: auth?.name ?? "sistema",
      role: auth?.role ?? "",
      action,
      entityType: entity.type,
      entityId: entity.id ? new Types.ObjectId(String(entity.id)) : null,
      entityLabel: entity.label ?? "",
      detail,
    });
  } catch (err) {
    console.error("[audit] no se pudo registrar", err);
  }
}

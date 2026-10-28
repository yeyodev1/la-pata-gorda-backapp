/**
 * Roles del sistema La Pata Gorda (levantamiento 27-oct-2026).
 * - admin:        Bakano / sistemas: configuración, usuarios, integraciones.
 * - gerencia:     Josué (dueño): ve todo, aprueba, cierra alertas.
 * - local:        administrador de un local: inventario diario, pedido al centro de producción, ventas del día.
 * - produccion:   centro de producción: recibe pedidos de los locales, planifica y despacha producción.
 * - bodega:       bodega central: stock de materia prima, recepción de compras, egresos a producción.
 * - compras:      compras de materia prima e insumos a proveedores.
 * - contabilidad: cierre, costos, cruce con el sistema contable.
 * - atencion:     atención a clientes: WhatsApp, reservas, reseñas.
 */
export const USER_ROLES = ["admin", "gerencia", "local", "produccion", "bodega", "compras", "contabilidad", "atencion"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Administración del sistema",
  gerencia: "Gerencia",
  local: "Administrador de local",
  produccion: "Centro de producción",
  bodega: "Bodega central",
  compras: "Compras",
  contabilidad: "Contabilidad",
  atencion: "Atención al cliente",
};

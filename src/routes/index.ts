import { Application, Router } from "express";
import { requireAuth, requireRole, requireInternalKey } from "../middlewares/auth.middleware";
import { rateLimit } from "../middlewares/security.middleware";
import * as auth from "../controllers/auth.controller";
import * as users from "../controllers/user.controller";
import * as cat from "../controllers/catalog.controller";
import * as inv from "../controllers/inventory.controller";
import * as sales from "../controllers/sales.controller";
import * as orders from "../controllers/order.controller";
import * as prod from "../controllers/production.controller";
import * as pur from "../controllers/purchase.controller";
import * as resv from "../controllers/reservation.controller";
import * as att from "../controllers/attention.controller";
import * as misc from "../controllers/misc.controller";
import * as shop from "../controllers/shop.controller";

/**
 * Permisos por rol (admin y gerencia pasan siempre; se valida en el servidor).
 * Ver src/utils/roles.ts para la descripción de cada rol.
 */
export default function routerApi(app: Application) {
  const r = Router();
  app.use("/api", r);

  const TODOS = requireAuth;
  const ADMIN = requireRole("admin");
  const LOCAL = requireRole("local", "produccion");
  const PRODUCCION = requireRole("produccion");
  const BODEGA = requireRole("bodega", "produccion", "compras");
  const COMPRAS = requireRole("compras", "bodega");
  const ATENCION = requireRole("atencion", "local");
  const CATALOGO = requireRole("produccion", "contabilidad");

  r.get("/health", misc.health);

  // Tienda en línea (pública, sin sesión)
  const pub = Router();
  app.use("/public", pub);
  pub.get("/storefront", shop.storefront);
  pub.post("/checkout", rateLimit(30, 10 * 60 * 1000), shop.checkout);
  pub.get("/orders/:code", shop.track);
  pub.post("/payphone/confirm", shop.payphoneReturn);
  pub.post("/reservations", rateLimit(20, 10 * 60 * 1000), shop.publicReservation);

  // Pantalla de pedidos de la tienda (locales y atención)
  r.get("/shop/board", TODOS, requireRole("local", "atencion", "produccion"), shop.board);
  r.get("/shop/orders", TODOS, requireRole("local", "atencion", "contabilidad"), shop.listCustomerOrders);
  r.get("/shop/orders/:id", TODOS, requireRole("local", "atencion", "contabilidad"), shop.getCustomerOrder);
  r.patch("/shop/orders/:id", TODOS, requireRole("local", "atencion"), shop.updateCustomerOrder);
  r.post("/shop/orders", TODOS, requireRole("local", "atencion"), shop.staffOrder);

  // Sesión y equipo
  r.post("/auth/login", rateLimit(10, 10 * 60 * 1000), auth.login);
  r.get("/auth/me", TODOS, auth.me);
  r.post("/auth/change-password", TODOS, auth.changePassword);
  r.get("/users", TODOS, ADMIN, users.listUsers);
  r.post("/users", TODOS, ADMIN, users.createUser);
  r.patch("/users/:id", TODOS, ADMIN, users.updateUser);

  // Catálogos
  r.get("/branches", TODOS, cat.listBranches);
  r.post("/branches", TODOS, ADMIN, cat.createBranch);
  r.patch("/branches/:id", TODOS, ADMIN, cat.updateBranch);
  r.get("/categories", TODOS, cat.listCategories);
  r.post("/categories", TODOS, CATALOGO, cat.saveCategory);
  r.patch("/categories/:id", TODOS, CATALOGO, cat.saveCategory);
  r.get("/products", TODOS, cat.listProducts);
  r.get("/products/:id", TODOS, cat.getProduct);
  r.post("/products", TODOS, CATALOGO, cat.createProduct);
  r.patch("/products/:id", TODOS, CATALOGO, cat.updateProduct);
  r.get("/ingredients", TODOS, cat.listIngredients);
  r.post("/ingredients", TODOS, requireRole("produccion", "bodega", "compras", "contabilidad"), cat.createIngredient);
  r.patch("/ingredients/:id", TODOS, requireRole("produccion", "bodega", "compras", "contabilidad"), cat.updateIngredient);
  r.get("/suppliers", TODOS, cat.listSuppliers);
  r.post("/suppliers", TODOS, COMPRAS, cat.createSupplier);
  r.patch("/suppliers/:id", TODOS, COMPRAS, cat.updateSupplier);

  // Inventario
  r.get("/stock", TODOS, inv.stockOf);
  r.get("/stock/overview", TODOS, requireRole("produccion", "bodega", "compras", "contabilidad"), inv.stockOverview);
  r.get("/stock/movements", TODOS, inv.movements);
  r.post("/stock/adjust", TODOS, requireRole("local", "produccion", "bodega"), inv.adjust);
  r.post("/stock/count", TODOS, requireRole("local", "produccion", "bodega"), inv.dailyCount);
  r.get("/stock/counts", TODOS, inv.listCounts);

  // Ventas por local
  r.get("/sales", TODOS, sales.listSales);
  r.get("/sales/day", TODOS, sales.getSales);
  r.post("/sales/close", TODOS, requireRole("local", "contabilidad"), sales.closeSales);

  // Pedidos de local a producción
  r.get("/orders/suggestion", TODOS, LOCAL, orders.suggestion);
  r.get("/orders", TODOS, orders.listOrders);
  r.get("/orders/:id", TODOS, orders.getOrder);
  r.post("/orders/draft", TODOS, LOCAL, orders.draft);
  r.patch("/orders/:id", TODOS, LOCAL, orders.update);
  r.post("/orders/:id/approve", TODOS, PRODUCCION, orders.approve);
  r.post("/orders/:id/dispatch", TODOS, PRODUCCION, orders.dispatch);
  r.post("/orders/:id/receive", TODOS, LOCAL, orders.receive);
  r.post("/orders/:id/cancel", TODOS, LOCAL, orders.cancel);

  // Producción
  r.get("/production/plans", TODOS, requireRole("produccion", "bodega", "compras", "contabilidad"), prod.listPlans);
  r.get("/production/plans/:id", TODOS, requireRole("produccion", "bodega", "compras", "contabilidad"), prod.getPlan);
  r.post("/production/plans/build", TODOS, PRODUCCION, prod.build);
  r.post("/production/plans/:id/produce", TODOS, PRODUCCION, prod.produce);
  r.post("/production/plans/:id/close", TODOS, PRODUCCION, prod.close);

  // Compras
  r.get("/purchases", TODOS, requireRole("compras", "bodega", "produccion", "contabilidad"), pur.listPurchases);
  r.get("/purchases/:id", TODOS, requireRole("compras", "bodega", "produccion", "contabilidad"), pur.getPurchase);
  r.post("/purchases", TODOS, COMPRAS, pur.create);
  r.patch("/purchases/:id", TODOS, COMPRAS, pur.update);
  r.post("/purchases/:id/receive", TODOS, BODEGA, pur.receive);

  // Reservas
  r.get("/reservations/availability", TODOS, resv.availability);
  r.get("/reservations", TODOS, resv.listReservations);
  r.post("/reservations", TODOS, ATENCION, resv.createReservation);
  r.patch("/reservations/:id", TODOS, ATENCION, resv.updateReservation);

  // Atención: WhatsApp y reseñas
  r.get("/conversations", TODOS, ATENCION, att.listConversations);
  r.get("/conversations/:id", TODOS, ATENCION, att.getConversation);
  r.post("/conversations/inbound", TODOS, ATENCION, att.inbound);
  r.post("/conversations/:id/reply", TODOS, ATENCION, att.reply);
  r.patch("/conversations/:id", TODOS, ATENCION, att.updateConversation);
  r.get("/reviews", TODOS, requireRole("atencion", "local"), att.listReviews);
  r.post("/reviews", TODOS, requireRole("atencion"), att.createReview);
  r.post("/reviews/:id/reply", TODOS, requireRole("atencion"), att.replyReview);

  // Panel, alertas, reportes, asistente, configuración, bitácora
  r.get("/dashboard", TODOS, misc.dashboard);
  r.get("/alerts", TODOS, misc.listAlerts);
  r.post("/alerts/:id/resolve", TODOS, misc.resolveAlert);
  r.get("/reports", TODOS, misc.reports);
  r.get("/assistant", TODOS, misc.assistantStatus);
  r.post("/assistant/ask", TODOS, misc.ask);
  r.post("/media/sign", TODOS, requireRole("produccion", "contabilidad", "atencion", "local"), misc.mediaSign);
  r.get("/settings", TODOS, misc.getConfig);
  r.patch("/settings", TODOS, requireRole("gerencia"), misc.updateConfig);
  r.get("/audit", TODOS, requireRole("contabilidad"), misc.listAudit);

  // Integraciones externas (agente de WhatsApp, Google reviews, POS): clave interna en x-internal-key
  const i = Router();
  app.use("/integrations", requireInternalKey, i);
  i.get("/menu", cat.listProducts);
  i.get("/branches", cat.listBranches);
  i.get("/reservations/availability", resv.availability);
  i.post("/reservations", resv.createReservation);
  i.post("/conversations/inbound", att.inbound);
  i.post("/reviews", att.createReview);
  i.post("/sales/close", sales.closeSales);
  i.post("/assistant/ask", misc.ask);
  i.post("/shop/orders", shop.staffOrder);
  i.get("/shop/orders/:code", shop.track);
}

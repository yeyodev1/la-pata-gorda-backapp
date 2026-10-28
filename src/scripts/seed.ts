/**
 * Seed de demostración: locales reales de la cadena, menú (58 platos de la carta, con recetas
 * aproximadas), insumos y preparados, cuentas de prueba por rol, 5 semanas de ventas por local,
 * existencias, pedidos, plan de producción, compras, reservas, WhatsApp y reseñas.
 * Clave de todas las cuentas: patagorda2026
 *
 *   npm run seed            → borra y vuelve a crear todo
 */
import bcrypt from "bcryptjs";
import mongoose, { Types } from "mongoose";
import { dbConnect } from "../config/mongo";
import { User } from "../models/user.model";
import { Branch } from "../models/branch.model";
import { Category, Product } from "../models/product.model";
import { Ingredient } from "../models/ingredient.model";
import { Supplier } from "../models/supplier.model";
import { StockLevel, StockMovement } from "../models/stock.model";
import { DailySales } from "../models/dailySales.model";
import { DailyCount } from "../models/dailyCount.model";
import { InternalOrder } from "../models/internalOrder.model";
import { ProductionPlan } from "../models/productionPlan.model";
import { Purchase } from "../models/purchase.model";
import { Reservation } from "../models/reservation.model";
import { Conversation } from "../models/conversation.model";
import { Review } from "../models/review.model";
import { Alert } from "../models/alert.model";
import { AuditEvent } from "../models/auditEvent.model";
import { Settings } from "../models/settings.model";
import { nextNumber } from "../models/counter.model";
import { setStock } from "../services/inventory.service";
import { draftOrder, updateAndSend, approveOrder, dispatchOrder, receiveOrder } from "../services/order.service";
import { buildPlan, registerProduction } from "../services/production.service";
import { createPurchase, receivePurchase } from "../services/purchase.service";
import { runDailyCron } from "../services/cron.service";
import { createCustomerOrder } from "../services/shop.service";
import { CustomerOrder } from "../models/customerOrder.model";
import { ecuadorDateString, addDaysStr, weekdayOf } from "../utils/dates";
import { round2, round3 } from "../utils/numbers";
import menu from "./data/menu.json";

const PASSWORD = "patagorda2026";

const BRANCHES = [
  { code: "GYE-ALV", name: "Pata Gorda Alvear", type: "local", city: "Guayaquil", address: "Av. Dr. Adolfo Alvear Ordóñez 116", capacity: 90, order: 1, size: 1.0 },
  { code: "GYE-URD", name: "Pata Gorda Urdesa", type: "local", city: "Guayaquil", address: "Urdesa Central", capacity: 80, order: 2, size: 0.9 },
  { code: "SAM", name: "Pata Gorda Samborondón", type: "local", city: "Samborondón", address: "Km 1.5 vía Samborondón", capacity: 110, order: 3, size: 1.2 },
  { code: "UIO", name: "Pata Gorda Quito", type: "local", city: "Quito", address: "Cumbayá", capacity: 70, order: 4, size: 0.7 },
  { code: "MEC", name: "Pata Gorda Manta", type: "local", city: "Manta", address: "Malecón de Manta", capacity: 60, order: 5, size: 0.6 },
  { code: "AMB", name: "Pata Gorda Ambato (franquicia)", type: "local", city: "Ambato", address: "Mall de los Andes, La Terraza", capacity: 80, order: 6, franchise: true, size: 0.6 },
  { code: "MIA", name: "La Pata Gorda Coral Gables", type: "local", city: "Miami", address: "232 Miracle Mile, Coral Gables", capacity: 70, order: 7, size: 0.8 },
  { code: "CP", name: "Centro de producción", type: "produccion", city: "Guayaquil", address: "Planta central", capacity: 0, order: 20, size: 0 },
  { code: "BOD", name: "Bodega central", type: "bodega", city: "Guayaquil", address: "Planta central", capacity: 0, order: 21, size: 0 },
] as const;

const USERS = [
  { name: "Bakano Sistemas", email: "admin@lapatagorda.app", role: "admin" },
  { name: "Josué Sánchez", email: "josue@lapatagorda.app", role: "gerencia" },
  { name: "Carolina Mite", email: "alvear@lapatagorda.app", role: "local", branch: "GYE-ALV" },
  { name: "Diego Zambrano", email: "urdesa@lapatagorda.app", role: "local", branch: "GYE-URD" },
  { name: "María José Ponce", email: "samborondon@lapatagorda.app", role: "local", branch: "SAM" },
  { name: "Andrés Vallejo", email: "quito@lapatagorda.app", role: "local", branch: "UIO" },
  { name: "Gabriela Cedeño", email: "manta@lapatagorda.app", role: "local", branch: "MEC" },
  { name: "Franquicia Ambato", email: "ambato@lapatagorda.app", role: "local", branch: "AMB" },
  { name: "Luis Herrera", email: "miami@lapatagorda.app", role: "local", branch: "MIA" },
  { name: "Rosa Quimí", email: "produccion@lapatagorda.app", role: "produccion" },
  { name: "Jorge Palma", email: "bodega@lapatagorda.app", role: "bodega" },
  { name: "Verónica Loor", email: "compras@lapatagorda.app", role: "compras" },
  { name: "Patricia Vera", email: "contabilidad@lapatagorda.app", role: "contabilidad" },
  { name: "Kevin Moreira (monitoreo 24h)", email: "atencion@lapatagorda.app", role: "atencion" },
] as const;

const SUPPLIERS = [
  { name: "Cangrejeros del Golfo", categories: ["mariscos"], creditDays: 7, phone: "0991110001" },
  { name: "Camaronera San Vicente", categories: ["mariscos"], creditDays: 15, phone: "0991110002" },
  { name: "Mercado Caraguay (concha y pescado)", categories: ["mariscos"], creditDays: 0, phone: "0991110003" },
  { name: "Distribuidora La Favorita", categories: ["granos", "insumos", "lacteos", "bebidas"], creditDays: 30, phone: "0991110004" },
  { name: "Plátanos El Oro", categories: ["verduras"], creditDays: 7, phone: "0991110005" },
];

// [code, name, group, unit, cost, producedInHouse, minStock, shelfLifeDays, supplier]
const INGREDIENTS: [string, string, string, string, number, boolean, number, number, string][] = [
  ["CANGREJO-VIVO", "Cangrejo vivo (planchas)", "mariscos", "un", 0.9, false, 0, 2, "Cangrejeros del Golfo"],
  ["CANGREJO-COC", "Cangrejo cocinado (unidades)", "preparados", "un", 1.2, true, 60, 2, ""],
  ["CARNE-CANG", "Carne de cangrejo desmenuzada", "preparados", "kg", 28, true, 4, 2, ""],
  ["CAMARON", "Camarón pelado", "mariscos", "kg", 7.5, false, 6, 3, "Camaronera San Vicente"],
  ["CONCHA", "Concha", "mariscos", "un", 0.35, false, 100, 2, "Mercado Caraguay (concha y pescado)"],
  ["CALAMAR", "Calamar", "mariscos", "kg", 6, false, 3, 3, "Mercado Caraguay (concha y pescado)"],
  ["PESCADO", "Pesca blanca (filete)", "mariscos", "kg", 6.5, false, 5, 2, "Mercado Caraguay (concha y pescado)"],
  ["PICUDO", "Picudo (filete)", "mariscos", "kg", 8, false, 2, 2, "Mercado Caraguay (concha y pescado)"],
  ["CORVINA", "Corvina entera", "mariscos", "un", 9, false, 4, 2, "Mercado Caraguay (concha y pescado)"],
  ["PULPO", "Pulpo", "mariscos", "kg", 12, false, 2, 3, "Mercado Caraguay (concha y pescado)"],
  ["SALSA-CRIOLLA", "Salsa criolla", "preparados", "porcion", 0.45, true, 40, 2, ""],
  ["SALSA-CASA", "Salsa de la casa", "preparados", "porcion", 0.6, true, 40, 3, ""],
  ["SALSA-AJILLO", "Salsa al ajillo", "preparados", "porcion", 0.7, true, 30, 3, ""],
  ["SALSA-MANI", "Salsa de maní", "preparados", "porcion", 0.55, true, 20, 3, ""],
  ["SALSA-AGUACATE", "Salsa de aguacate", "preparados", "porcion", 0.5, true, 30, 1, ""],
  ["SALSA-PATA", "Salsa Pata Gorda (olla)", "preparados", "lt", 3.5, true, 10, 3, ""],
  ["COCOLON", "Cocolón", "preparados", "porcion", 0.4, true, 40, 1, ""],
  ["ARROZ-COC", "Arroz cocido", "preparados", "porcion", 0.3, true, 60, 1, ""],
  ["MADURO-FRITO", "Maduro frito", "preparados", "porcion", 0.35, true, 60, 1, ""],
  ["CHIFLES", "Chifles", "preparados", "porcion", 0.25, true, 80, 7, ""],
  ["PATACONES", "Patacones", "preparados", "porcion", 0.4, true, 30, 1, ""],
  ["EMPANIZADO", "Empanizado de la casa", "preparados", "kg", 2.2, true, 5, 10, ""],
  ["ARROZ", "Arroz crudo", "granos", "kg", 1.1, false, 40, 0, "Distribuidora La Favorita"],
  ["VERDE", "Plátano verde", "verduras", "un", 0.25, false, 80, 5, "Plátanos El Oro"],
  ["MADURO", "Plátano maduro", "verduras", "un", 0.25, false, 80, 4, "Plátanos El Oro"],
  ["CEBOLLA", "Cebolla colorada", "verduras", "kg", 1.4, false, 10, 7, "Distribuidora La Favorita"],
  ["TOMATE", "Tomate", "verduras", "kg", 1.3, false, 8, 5, "Distribuidora La Favorita"],
  ["PIMIENTO", "Pimiento", "verduras", "kg", 1.6, false, 4, 5, "Distribuidora La Favorita"],
  ["CILANTRO", "Cilantro", "verduras", "un", 0.4, false, 10, 3, "Distribuidora La Favorita"],
  ["LIMON", "Limón", "verduras", "un", 0.08, false, 150, 7, "Distribuidora La Favorita"],
  ["AJO", "Ajo pelado", "verduras", "kg", 4, false, 2, 15, "Distribuidora La Favorita"],
  ["AGUACATE", "Aguacate", "verduras", "un", 0.6, false, 20, 4, "Distribuidora La Favorita"],
  ["PAPA", "Papa", "verduras", "kg", 0.9, false, 15, 10, "Distribuidora La Favorita"],
  ["MANI", "Maní tostado", "insumos", "kg", 4.5, false, 3, 30, "Distribuidora La Favorita"],
  ["ACEITE", "Aceite", "insumos", "lt", 2.1, false, 20, 90, "Distribuidora La Favorita"],
  ["PASAS", "Pasas", "insumos", "kg", 5, false, 1, 90, "Distribuidora La Favorita"],
  ["MANTEQUILLA", "Mantequilla", "lacteos", "kg", 6.5, false, 2, 30, "Distribuidora La Favorita"],
  ["QUESO", "Queso", "lacteos", "kg", 5.5, false, 2, 15, "Distribuidora La Favorita"],
  ["LOMO", "Lomo fino", "carnes", "kg", 11, false, 2, 3, "Distribuidora La Favorita"],
  ["POLLO", "Pechuga de pollo", "carnes", "kg", 5.5, false, 3, 3, "Distribuidora La Favorita"],
  ["CHORIZO", "Chorizo", "carnes", "kg", 6, false, 1, 7, "Distribuidora La Favorita"],
  ["COLA", "Cola 300 ml (vidrio)", "bebidas", "un", 0.7, false, 48, 0, "Distribuidora La Favorita"],
  ["COLA-ZERO", "Coca-Cola Zero 300 ml", "bebidas", "un", 0.7, false, 24, 0, "Distribuidora La Favorita"],
  ["TE", "Té helado", "bebidas", "un", 0.5, false, 24, 0, "Distribuidora La Favorita"],
];

/** Recetas de los preparados (por 1 unidad producida). */
const PREP_RECIPES: Record<string, [string, number][]> = {
  "CANGREJO-COC": [["CANGREJO-VIVO", 1], ["SALSA-PATA", 0.03]],
  "CARNE-CANG": [["CANGREJO-COC", 9]],
  "SALSA-CRIOLLA": [["CEBOLLA", 0.04], ["TOMATE", 0.03], ["LIMON", 1], ["CILANTRO", 0.05]],
  "SALSA-CASA": [["TOMATE", 0.03], ["ACEITE", 0.01], ["AJO", 0.005]],
  "SALSA-AJILLO": [["AJO", 0.012], ["MANTEQUILLA", 0.02], ["ACEITE", 0.01]],
  "SALSA-MANI": [["MANI", 0.04], ["CEBOLLA", 0.01], ["ACEITE", 0.005]],
  "SALSA-AGUACATE": [["AGUACATE", 0.5], ["LIMON", 0.5], ["CILANTRO", 0.05]],
  "SALSA-PATA": [["CEBOLLA", 0.2], ["PIMIENTO", 0.1], ["AJO", 0.03], ["ACEITE", 0.1], ["CILANTRO", 0.3]],
  "COCOLON": [["ARROZ", 0.1], ["ACEITE", 0.01]],
  "ARROZ-COC": [["ARROZ", 0.09]],
  "MADURO-FRITO": [["MADURO", 0.5], ["ACEITE", 0.02]],
  "CHIFLES": [["VERDE", 0.5], ["ACEITE", 0.02]],
  "PATACONES": [["VERDE", 0.7], ["ACEITE", 0.03]],
  "EMPANIZADO": [["ARROZ", 0.3]],
};

/** Receta aproximada de cada plato según su nombre (consumo por 1 plato vendido). */
function productRecipe(name: string, category: string): [string, number][] {
  const n = name.toLowerCase();
  const r: [string, number][] = [];
  const add = (code: string, qty: number) => { const i = r.findIndex((x) => x[0] === code); if (i >= 0) r[i]![1] = round3(r[i]![1] + qty); else r.push([code, qty]); };
  if (category === "Acompañantes") {
    if (n.includes("chifles")) add("CHIFLES", 1); else if (n.includes("criolla")) add("SALSA-CRIOLLA", 1); else if (n.includes("casa")) add("SALSA-CASA", 1); else if (n.includes("ajillo")) add("SALSA-AJILLO", 1);
    else if (n.includes("cocol")) add("COCOLON", 1); else if (n.includes("queso")) { add("QUESO", 0.08); if (n.includes("patacon")) add("PATACONES", 1); } else if (n.includes("arroz")) add("ARROZ-COC", 1);
    else if (n.includes("papas")) { add("PAPA", 0.25); add("ACEITE", 0.03); } else if (n.includes("guacamole")) { add("AGUACATE", 1.5); add("CEBOLLA", 0.03); add("LIMON", 1); } else if (n.includes("pure")) add("PAPA", 0.25);
    return r;
  }
  if (category === "Bebidas") { if (n.includes("zero")) add("COLA-ZERO", 1); else if (n.includes("cola")) add("COLA", 1); else add("TE", 1); return r; }
  if (category === "Menú de Niños") { if (n.includes("pollo")) { add("POLLO", 0.15); add("EMPANIZADO", 0.05); add("PAPA", 0.2); } else { add("QUESO", 0.08); add("PAPA", 0.15); } return r; }
  // Proteínas
  if (n.includes("combo cangrejos") || n.includes("cangrejos al ajillo") || n.includes("cangrejo salsa")) { add("CANGREJO-COC", n.includes("combo") ? 4 : 3); add("MADURO-FRITO", 1); }
  else if (n.includes("cangrejo") || n.includes("carapacho") || n.includes("favorito de josué") || n.includes("empachadito") || n.includes("mega")) add("CARNE-CANG", n.includes("ensalada") || n.includes("ceviche") ? 0.22 : n.includes("crema") ? 0.1 : n.includes("carapacho") ? 0.12 : 0.2);
  if (n.includes("camar") || n.includes("favorito de josué") || n.includes("mega") || n.includes("marinero") || n.includes("mariscos") || n.includes("manaba") || n.includes("cuchara") || n.includes("mixta") || n.includes("guacamarones")) add("CAMARON", n.includes("media libra") ? 0.23 : n.includes("guacamarones") ? 0.12 : 0.18);
  if (n.includes("concha") || n.includes("marinero")) add("CONCHA", n.includes("conchas") ? 12 : 6);
  if (n.includes("calamar") || n.includes("marinero") || n.includes("mariscos") || n.includes("cuchara") || n.includes("viche") || n.includes("favorito de josué") && n.includes("ceviche")) add("CALAMAR", 0.1);
  if (n.includes("pescado") || n.includes("mariscos") || n.includes("mixta") || n.includes("cuchara")) add("PESCADO", 0.18);
  if (n.includes("picudo")) add("PICUDO", 0.3);
  if (n.includes("corvina")) add("CORVINA", 1);
  if (n.includes("viche")) add("PULPO", 0.08);
  if (n.includes("guayaco") || n.includes("mar y tierra")) { add("LOMO", 0.12); add("POLLO", 0.1); add("CHORIZO", 0.06); }
  // Bases y salsas
  if (n.includes("chops") || n.includes("empachadito") || n.includes("cuchara") || n.includes("manaba") || n.includes("guayaco") || n.includes("mega")) { add("ARROZ-COC", 1); add("COCOLON", 0.5); add("MADURO-FRITO", 1); add("SALSA-CRIOLLA", 1); add("SALSA-CASA", 1); }
  if (n.includes("arroz") || n.includes("meloso") || n.includes("cazuela") || n.includes("crema")) { add("ARROZ-COC", n.includes("cazuela") ? 0.5 : 1); if (!n.includes("cazuela")) { add("MADURO-FRITO", 1); add("SALSA-CRIOLLA", 1); add("SALSA-AGUACATE", 1); } }
  if (n.includes("cazuela")) { add("VERDE", 2); add("MANI", 0.04); }
  if (n.includes("ajillo")) add("SALSA-AJILLO", 1);
  if (n.includes("maní") || n.includes("mani") || n.includes("jipijapa") || n.includes("manaba") || n.includes("viche")) add("SALSA-MANI", 1);
  if (n.includes("ceviche")) { add("CHIFLES", 1); add("LIMON", 3); add("CEBOLLA", 0.05); if (!n.includes("camarón")) add("SALSA-AGUACATE", 1); if (n.includes("camarón") && !n.includes("jipijapa")) add("TOMATE", 0.08); }
  if (n.includes("conchas")) { add("PATACONES", 1); add("MANTEQUILLA", 0.03); }
  if (n.includes("chicharrón") || n.includes("apanados")) { add("EMPANIZADO", 0.08); add("ACEITE", 0.05); add("CHIFLES", 1); }
  if (n.includes("guacamarones")) { add("VERDE", 2); add("AGUACATE", 1); add("SALSA-CRIOLLA", 1); }
  if (n.includes("carapacho")) { add("MADURO", 0.5); add("PASAS", 0.01); add("SALSA-CRIOLLA", 1); }
  if (n.includes("ensalada")) { add("TOMATE", 0.1); add("CEBOLLA", 0.05); add("AGUACATE", 0.5); add("LIMON", 1); }
  if (n.includes("plancha") || n.includes("picudo") || n.includes("corvina")) { add("ARROZ-COC", 1); add("MADURO-FRITO", 1); add("SALSA-CRIOLLA", 1); }
  if (n.includes("cuchara")) add("PAPA", 0.15);
  return r;
}

/** Opciones que elige el cliente en la tienda (según la carta). */
function productOptions(name: string, category: string): { name: string; required: boolean; max: number; choices: { label: string; price: number }[] }[] {
  const n = name.toLowerCase();
  const out: { name: string; required: boolean; max: number; choices: { label: string; price: number }[] }[] = [];
  if (category === "Chopsué" || category === "Empachaditos" || n.includes("chops")) out.push({ name: "Base", required: true, max: 1, choices: [{ label: "Arroz", price: 0 }, { label: "Cocolón", price: 0 }, { label: "Mixto (arroz y cocolón)", price: 0 }] });
  if (n.includes("picudo") || n.includes("corvina")) out.push({ name: "Preparación", required: true, max: 1, choices: [{ label: "Frito", price: 0 }, { label: "Grill", price: 0 }, { label: "Al ajillo", price: 0 }] });
  if (n.includes("picudo")) out.push({ name: "Guarniciones (2)", required: true, max: 2, choices: [{ label: "Arroz", price: 0 }, { label: "Maduro frito", price: 0 }, { label: "Patacones", price: 0 }, { label: "Ensalada", price: 0 }, { label: "Papas fritas", price: 0 }] });
  if (n.includes("ceviche de concha")) out.push({ name: "Concha", required: true, max: 1, choices: [{ label: "Cruda", price: 0 }, { label: "Cocinada", price: 0 }] });
  if (!["Acompañantes", "Bebidas", "Menú de Niños"].includes(category) && !n.includes("crema") && !n.includes("viche")) out.push({ name: "Extras", required: false, max: 3, choices: [{ label: "Porción extra de salsa criolla", price: 2.35 }, { label: "Porción de cocolón", price: 3.05 }, { label: "Chifles", price: 1 }, { label: "Salsa al ajillo", price: 3.05 }] });
  return out;
}

function rnd(seed: { v: number }) { seed.v = (seed.v * 1103515245 + 12345) % 2147483648; return seed.v / 2147483648; }

async function main() {
  await dbConnect();
  console.log("[seed] limpiando…");
  await Promise.all([User, Branch, Category, Product, Ingredient, Supplier, StockLevel, StockMovement, DailySales, DailyCount, InternalOrder, ProductionPlan, Purchase, Reservation, Conversation, Review, Alert, AuditEvent, Settings, CustomerOrder].map((m) => (m as mongoose.Model<unknown>).deleteMany({})));
  await mongoose.connection.collection("counters").deleteMany({});
  await Settings.create({ key: "global", whatsappNumber: "+593 99 000 0000" });

  // Locales
  const PRIVATE: Record<string, { name: string; capacity: number }[]> = { SAM: [{ name: "Privado terraza", capacity: 14 }], "GYE-URD": [{ name: "Salón privado", capacity: 12 }] };
  const COORDS: Record<string, [number, number]> = { "GYE-ALV": [-2.1588, -79.9009], "GYE-URD": [-2.1694, -79.9063], SAM: [-2.1178, -79.8715], UIO: [-0.2027, -78.4287], MEC: [-0.9494, -80.7290], AMB: [-1.2641, -78.6200], MIA: [25.7503, -80.2591] };
  const branchDocs = await Branch.insertMany(BRANCHES.map(({ size: _s, ...b }) => ({ ...b, franchise: "franchise" in b ? Boolean(b.franchise) : false, hours: b.city === "Miami" ? "11:30-22:00" : "12:00-22:00", whatsapp: b.type === "local" ? "+593990000000" : "", deliveryEnabled: b.type === "local" && b.code !== "MIA", pickupEnabled: b.type === "local", deliveryFee: b.city === "Samborondón" ? 3.5 : 2.5, prepMinutes: 25, privateTables: PRIVATE[b.code] ?? [], lat: COORDS[b.code]?.[0] ?? null, lng: COORDS[b.code]?.[1] ?? null, deliveryRadiusKm: b.city === "Quito" ? 15 : 12 })));
  const B = (code: string) => branchDocs.find((b) => b.code === code)!;
  const locals = branchDocs.filter((b) => b.type === "local");
  const sizeOf = new Map(BRANCHES.map((b) => [b.code, b.size]));

  // Usuarios
  const hash = await bcrypt.hash(PASSWORD, 10);
  const users = await User.insertMany(USERS.map((u) => ({ name: u.name, email: u.email, passwordHash: hash, role: u.role, branch: "branch" in u ? B(u.branch)._id : null })));
  const U = (role: string) => users.find((u) => u.role === role)!;
  const authOf = (u: { _id: Types.ObjectId; name: string; role: string; branch: Types.ObjectId | null }) => ({ sub: String(u._id), name: u.name, role: u.role as never, branch: u.branch ? String(u.branch) : null });

  // Proveedores e insumos
  const supplierDocs = await Supplier.insertMany(SUPPLIERS);
  const S = (name: string) => supplierDocs.find((s) => s.name === name);
  const ingDocs = await Ingredient.insertMany(INGREDIENTS.map(([code, name, group, unit, cost, producedInHouse, minStock, shelfLifeDays, supplier]) => ({ code, name, group, unit, cost, producedInHouse, minStock, shelfLifeDays, supplier: supplier ? S(supplier)?._id ?? null : null })));
  const I = (code: string) => ingDocs.find((i) => i.code === code)!;
  for (const [code, lines] of Object.entries(PREP_RECIPES)) await Ingredient.updateOne({ _id: I(code)._id }, { recipe: lines.map(([c, qty]) => ({ ingredient: I(c)._id, qty })) });

  // Menú
  const catNames = [...new Map((menu as { category: string; categoryOrder: number }[]).map((m) => [m.category, m.categoryOrder])).entries()];
  const catDocs = await Category.insertMany(catNames.map(([name, order]) => ({ name, order })));
  const C = (name: string) => catDocs.find((c) => c.name === name)!;
  const productDocs = await Product.insertMany((menu as { code: string; name: string; category: string; price: number; description: string; image: string; featured: boolean }[]).map((m) => ({ code: m.code, name: m.name, category: C(m.category)._id, price: m.price, description: m.description, image: m.image, featured: m.featured, recipe: productRecipe(m.name, m.category).map(([c, qty]) => ({ ingredient: I(c)._id, qty })), excludedBranches: m.category === "Bebidas" ? [B("MIA")._id] : [], online: true, options: productOptions(m.name, m.category) })));
  console.log(`[seed] ${productDocs.length} platos, ${ingDocs.length} insumos, ${branchDocs.length} lugares`);

  // Ventas: 5 semanas por local (peso por día de semana y por tamaño del local)
  const today = ecuadorDateString();
  const seed = { v: 42 };
  const weekdayFactor = [1.7, 0.75, 0.8, 0.85, 0.95, 1.2, 1.5]; // dom … sáb
  const dishes = productDocs.filter((p) => !["Acompañantes", "Bebidas"].includes(C(String(catDocs.find((c) => String(c._id) === String(p.category))!.name)).name));
  const sides = productDocs.filter((p) => ["Acompañantes", "Bebidas"].includes(catDocs.find((c) => String(c._id) === String(p.category))!.name));
  const salesDocs = [];
  for (const b of locals) {
    const size = sizeOf.get(b.code) ?? 1;
    for (let d = 35; d >= 1; d--) {
      const date = addDaysStr(today, -d);
      const wd = weekdayOf(date);
      const plates = Math.round(70 * size * weekdayFactor[wd]! * (0.85 + rnd(seed) * 0.3));
      const counts = new Map<string, number>();
      for (let k = 0; k < plates; k++) {
        const pool = rnd(seed) < 0.55 ? dishes.filter((p) => p.featured) : dishes;
        const p = pool[Math.floor(rnd(seed) * pool.length)]!;
        if (p.excludedBranches.some((x) => String(x) === String(b._id))) continue;
        counts.set(String(p._id), (counts.get(String(p._id)) ?? 0) + 1);
      }
      for (let k = 0; k < Math.round(plates * 0.6); k++) { const p = sides[Math.floor(rnd(seed) * sides.length)]!; if (p.excludedBranches.some((x) => String(x) === String(b._id))) continue; counts.set(String(p._id), (counts.get(String(p._id)) ?? 0) + 1); }
      const items = [...counts.entries()].map(([id, qty]) => { const p = productDocs.find((x) => String(x._id) === id)!; return { product: p._id, productName: p.name, qty, amount: round2(qty * p.price) }; });
      salesDocs.push({ branch: b._id, date, weekday: wd, items, totalQty: items.reduce((a, i) => a + i.qty, 0), totalAmount: round2(items.reduce((a, i) => a + i.amount, 0)), tickets: Math.round(plates / 2.3), source: "importado", consumed: true, closedBy: "POS" });
    }
  }
  await DailySales.insertMany(salesDocs);
  console.log(`[seed] ${salesDocs.length} días de ventas`);

  // Existencias iniciales: locales con ~1 día de preparados; producción y bodega con stock de materia prima
  const sys = authOf(U("admin"));
  const admin = { ...sys, name: "Carga inicial" };
  for (const b of locals) {
    const size = sizeOf.get(b.code) ?? 1;
    for (const ing of ingDocs.filter((i) => i.producedInHouse || i.group === "bebidas" || ["CAMARON", "CONCHA", "LIMON", "AGUACATE", "QUESO"].includes(i.code))) {
      const base = ing.unit === "porcion" ? 35 : ing.unit === "un" ? (ing.code === "CANGREJO-COC" ? 45 : ing.group === "bebidas" ? 40 : 60) : ing.unit === "kg" ? 4 : 6;
      await setStock({ branch: b._id, ingredient: ing._id, qty: round3(base * size * (0.5 + rnd(seed))), note: "Carga inicial", userName: admin.name, type: "ingreso", refType: "Seed" });
    }
  }
  for (const ing of ingDocs.filter((i) => i.producedInHouse)) await setStock({ branch: B("CP")._id, ingredient: ing._id, qty: round3((ing.unit === "porcion" ? 120 : ing.unit === "un" ? 150 : 12) * (0.4 + rnd(seed))), note: "Carga inicial", userName: admin.name, type: "ingreso", refType: "Seed" });
  for (const ing of ingDocs.filter((i) => !i.producedInHouse)) await setStock({ branch: B("BOD")._id, ingredient: ing._id, qty: round3((ing.unit === "un" ? (ing.code === "CANGREJO-VIVO" ? 900 : ing.code === "LIMON" ? 1200 : 300) : ing.unit === "kg" ? (ing.code === "ARROZ" ? 180 : 25) : 60) * (0.5 + rnd(seed))), note: "Carga inicial", userName: admin.name, type: "ingreso", refType: "Seed" });

  // Pedidos de hoy (recibidos) y de mañana (en distintos estados)
  const tomorrow = addDaysStr(today, 1);
  const prodAuth = authOf(U("produccion"));
  const localAuth = (code: string) => authOf(users.find((u) => u.role === "local" && String(u.branch) === String(B(code)._id))!);
  for (const code of ["GYE-ALV", "GYE-URD", "SAM", "UIO", "MEC"]) {
    const o = await draftOrder(localAuth(code), String(B(code)._id), today);
    await updateAndSend(localAuth(code), String(o._id), { send: true });
    await approveOrder(prodAuth, String(o._id), {});
    await dispatchOrder(prodAuth, String(o._id), {});
    await receiveOrder(localAuth(code), String(o._id), {});
  }
  // Mañana: Alvear envió normal; Samborondón pide de más (inflado, con justificación); Urdesa en borrador; Manta aprobado
  const alv = await draftOrder(localAuth("GYE-ALV"), String(B("GYE-ALV")._id), tomorrow);
  await updateAndSend(localAuth("GYE-ALV"), String(alv._id), { send: true, notes: "Pedido normal" });
  const sam = await draftOrder(localAuth("SAM"), String(B("SAM")._id), tomorrow);
  const samItems = sam.items.map((it) => ({ ingredient: String(it.ingredient), requested: it.suggested }));
  for (const it of samItems) { const ing = ingDocs.find((i) => String(i._id) === it.ingredient)!; if (["CANGREJO-COC", "CARNE-CANG"].includes(ing.code)) it.requested = round3(it.requested * 1.8 + 10); }
  await updateAndSend(localAuth("SAM"), String(sam._id), { send: true, items: samItems.map((it) => ({ ...it, justification: "Tenemos evento privado de 40 personas el sábado" })) });
  await draftOrder(localAuth("GYE-URD"), String(B("GYE-URD")._id), tomorrow);
  const mec = await draftOrder(localAuth("MEC"), String(B("MEC")._id), tomorrow);
  await updateAndSend(localAuth("MEC"), String(mec._id), { send: true });
  await approveOrder(prodAuth, String(mec._id), { productionNote: "Aprobado tal cual" });

  // Plan de producción de mañana con algo ya producido
  const plan = await buildPlan(prodAuth, tomorrow);
  const first = plan.items.find((i) => i.toProduce > 0);
  if (first) await registerProduction(prodAuth, String(plan._id), { ingredient: String(first.ingredient), qty: round3(first.toProduce * 0.5), note: "Primer lote de la mañana" });

  // Compras: una recibida ayer, una pedida, un requerimiento
  const comprasAuth = authOf(U("compras"));
  const bodegaAuth = authOf(U("bodega"));
  const c1 = await createPurchase(comprasAuth, { supplier: String(S("Cangrejeros del Golfo")!._id), items: [{ ingredient: String(I("CANGREJO-VIVO")._id), qty: 600, unitCost: 0.9 }], expectedAt: addDaysStr(today, -1), status: "pedida" });
  await receivePurchase(bodegaAuth, String(c1._id), { invoiceNumber: "001-002-000045120" });
  await createPurchase(comprasAuth, { supplier: String(S("Camaronera San Vicente")!._id), items: [{ ingredient: String(I("CAMARON")._id), qty: 80, unitCost: 7.4 }], expectedAt: tomorrow, status: "pedida" });
  await createPurchase(comprasAuth, { supplier: String(S("Plátanos El Oro")!._id), items: [{ ingredient: String(I("VERDE")._id), qty: 400 }, { ingredient: String(I("MADURO")._id), qty: 400 }], expectedAt: addDaysStr(today, 2), notes: "Confirmar precio de la semana" });

  // Reservas
  const resv = [
    ["GYE-ALV", today, "13:00", "Familia Andrade", "0998811223", 6, "confirmada", "whatsapp"],
    ["GYE-ALV", today, "20:00", "Carlos Peña", "0991234567", 2, "pendiente", "agente"],
    ["SAM", today, "13:30", "Cumpleaños Valeria", "0987654321", 12, "confirmada", "whatsapp"],
    ["SAM", tomorrow, "19:30", "Empresa Logitrans", "0999001122", 40, "pendiente", "telefono"],
    ["UIO", today, "14:00", "Ana Torres", "0995556677", 4, "sentada", "web"],
    ["MIA", today, "19:00", "The Garcias", "+1 305 555 0101", 5, "confirmada", "web"],
    ["MEC", tomorrow, "13:00", "Pedro Loor", "0993334455", 3, "pendiente", "whatsapp"],
  ] as const;
  for (const [code, date, time, name, phone, people, status, channel] of resv) await Reservation.create({ number: await nextNumber("RES"), branch: B(code)._id, branchName: B(code).name, date, time, name, phone, people, status, channel, createdBy: "seed" });

  // WhatsApp
  const now = Date.now();
  await Conversation.insertMany([
    { phone: "0998811223", name: "Familia Andrade", topic: "reserva", status: "esperando", assignedTo: "Kevin Moreira (monitoreo 24h)", unread: 0, lastMessageAt: new Date(now - 3600000 * 5), lastText: "Listo, confirmada su mesa para 6 a la 1 pm en Alvear.", messages: [{ direction: "entrante", text: "Hola, quiero reservar para 6 personas hoy a la 1", by: "Familia Andrade", at: new Date(now - 3600000 * 6) }, { direction: "saliente", text: "Listo, confirmada su mesa para 6 a la 1 pm en Alvear.", by: "Kevin Moreira (monitoreo 24h)", at: new Date(now - 3600000 * 5) }] },
    { phone: "0991234567", name: "Carlos Peña", topic: "reserva", status: "abierta", unread: 1, lastMessageAt: new Date(now - 3600000 * 3), lastText: "¿Tienen mesa para 2 hoy a las 8 en Urdesa o Alvear?", messages: [{ direction: "entrante", text: "¿Tienen mesa para 2 hoy a las 8 en Urdesa o Alvear?", by: "Carlos Peña", at: new Date(now - 3600000 * 3) }] },
    { phone: "0987001122", name: "", topic: "queja", status: "abierta", unread: 2, lastMessageAt: new Date(now - 3600000 * 2.5), lastText: "Llevo 20 minutos esperando que me contesten para pedir a domicilio", messages: [{ direction: "entrante", text: "Buenas, quiero pedir a domicilio en Samborondón", by: "0987001122", at: new Date(now - 3600000 * 3) }, { direction: "entrante", text: "Llevo 20 minutos esperando que me contesten para pedir a domicilio", by: "0987001122", at: new Date(now - 3600000 * 2.5) }] },
    { phone: "0999001122", name: "Logitrans S.A.", topic: "evento", status: "esperando", unread: 0, lastMessageAt: new Date(now - 3600000 * 20), lastText: "Perfecto, les pasamos la cotización del menú para 40 personas.", messages: [{ direction: "entrante", text: "Queremos hacer una cena de empresa para 40 personas mañana en Samborondón", by: "Logitrans S.A.", at: new Date(now - 3600000 * 21) }, { direction: "saliente", text: "Perfecto, les pasamos la cotización del menú para 40 personas.", by: "Kevin Moreira (monitoreo 24h)", at: new Date(now - 3600000 * 20) }] },
  ]);

  // Reseñas de Google
  await Review.insertMany([
    { branch: B("SAM")._id, branchName: B("SAM").name, source: "google", externalId: "g-1001", author: "María Fernanda R.", rating: 5, text: "El chopsué criollo es increíble, el mejor cangrejo de Guayaquil. Atención rápida.", reviewedAt: new Date(now - 86400000), reply: "¡Gracias María Fernanda! Nos encanta que hayas disfrutado el chopsué. Te esperamos pronto.", repliedBy: "agente", repliedAt: new Date(now - 80000000), status: "respondida" },
    { branch: B("GYE-URD")._id, branchName: B("GYE-URD").name, source: "google", externalId: "g-1002", author: "Jorge A.", rating: 2, text: "Esperamos 50 minutos por los cangrejos y llegaron tibios. El local estaba lleno y nadie atendía.", reviewedAt: new Date(now - 3600000 * 10), status: "nueva" },
    { branch: B("UIO")._id, branchName: B("UIO").name, source: "google", externalId: "g-1003", author: "Daniela V.", rating: 4, text: "Muy rico el ceviche jipijapa. Un poco caro pero vale la pena.", reviewedAt: new Date(now - 3600000 * 30), status: "nueva" },
    { branch: B("MIA")._id, branchName: B("MIA").name, source: "google", externalId: "g-1004", author: "Luis M.", rating: 5, text: "Finally real Ecuadorian crab in Miami. The carapacho relleno is a must.", reviewedAt: new Date(now - 3600000 * 50), reply: "Thank you Luis! See you soon on Miracle Mile.", repliedBy: "agente", repliedAt: new Date(now - 3600000 * 48), status: "respondida" },
    { branch: B("GYE-ALV")._id, branchName: B("GYE-ALV").name, source: "google", externalId: "g-1005", author: "Patricia C.", rating: 1, text: "Pedí por WhatsApp y nunca me respondieron. Los números de los locales ya no existen.", reviewedAt: new Date(now - 3600000 * 4), status: "nueva" },
  ]);

  // Conteo de inventario de ayer en Urdesa con faltante
  const urd = B("GYE-URD");
  const carne = I("CARNE-CANG");
  const lvl = await StockLevel.findOne({ branch: urd._id, ingredient: carne._id });
  const before = lvl?.qty ?? 0;
  await DailyCount.create({ branch: urd._id, date: addDaysStr(today, -1), items: [{ ingredient: carne._id, ingredientName: carne.name, expected: round3(before + 1.2), counted: before, diff: -1.2 }], diffValue: round2(-1.2 * carne.cost), note: "Faltó carne de cangrejo al cierre", countedBy: "Diego Zambrano" });
  await Alert.create({ type: "diferencia_inventario", severity: "warning", title: `${urd.name}: ${carne.name} faltan 1.2 kg`, body: `Sistema: ${round3(before + 1.2)} · Contado: ${before} · $${round2(1.2 * carne.cost)}`, branch: urd._id, branchName: urd.name, audience: ["gerencia", "produccion", "contabilidad"], key: `conteo:${urd._id}:${carne._id}:${addDaysStr(today, -1)}` });

  // Pedidos de la tienda en línea (hoy)
  const Pn = (name: string) => productDocs.find((p) => p.name === name)!;
  const mkOrder = async (code: string, type: "retiro" | "domicilio", customer: { name: string; phone: string }, items: { product: string; qty: number; options?: { name: string; choice: string }[]; notes?: string }[], payment: string, status: string, minutesAgo: number, address?: string, channel: "web" | "whatsapp" | "agente" = "web") => {
    const { order } = await createCustomerOrder({ branch: String(B(code)._id), type, customer, address: address ? { text: address, reference: "" } : undefined, items, payment, channel, notes: "" });
    const steps: Record<string, string[]> = { nuevo: [], aceptado: ["aceptado"], en_preparacion: ["aceptado", "en_preparacion"], listo: ["aceptado", "en_preparacion", "listo"], en_camino: ["aceptado", "en_preparacion", "listo", "en_camino"], entregado: ["aceptado", "en_preparacion", "listo", "entregado"] };
    const at = new Date(Date.now() - minutesAgo * 60000);
    for (const st of steps[status] ?? []) { order.status = st as never; order.timeline.push({ status: st, at: new Date(at.getTime() + 60000 * order.timeline.length), by: "Carolina Mite", note: "" }); }
    if (status === "entregado" || payment === "payphone") { order.payment.status = "pagado"; order.payment.paidAt = at; order.payment.reference = payment === "payphone" ? "PP-" + Math.floor(Math.random() * 1e6) : "cobrado en caja"; }
    if (status !== "nuevo") order.enteredInPos = true;
    await order.save();
    await CustomerOrder.updateOne({ _id: order._id }, { $set: { createdAt: at } });
    return order;
  };
  await mkOrder("GYE-ALV", "retiro", { name: "Andrea Cornejo", phone: "0998123456" }, [{ product: String(Pn("Chopsué Criollo")._id), qty: 2, options: [{ name: "Base", choice: "Mixto (arroz y cocolón)" }] }, { product: String(Pn("Ceviche de Camarón")._id), qty: 1 }, { product: String(Pn("Cola")._id), qty: 2 }], "local", "nuevo", 3);
  await mkOrder("GYE-ALV", "domicilio", { name: "Roberto Jaramillo", phone: "0991112233" }, [{ product: String(Pn("Combo Cangrejos Criollos")._id), qty: 1, options: [{ name: "Extras", choice: "Chifles" }] }, { product: String(Pn("Guacamarones")._id), qty: 1 }], "efectivo", "en_preparacion", 18, "Cdla. Kennedy Norte, Mz 12 villa 4");
  await mkOrder("SAM", "retiro", { name: "Lucía Pazmiño", phone: "0987776655" }, [{ product: String(Pn("Empachadito de Cangrejo")._id), qty: 1, options: [{ name: "Base", choice: "Cocolón" }] }, { product: String(Pn("Chopsué \"El Favorito de Josué\"")._id), qty: 1, options: [{ name: "Base", choice: "Arroz" }], notes: "sin cebolla" }], "local", "listo", 32, undefined, "whatsapp");
  await mkOrder("SAM", "domicilio", { name: "Familia Ortega", phone: "0993334444" }, [{ product: String(Pn("Arroz Marinero")._id), qty: 2 }, { product: String(Pn("Conchas Asadas")._id), qty: 1 }, { product: String(Pn("Té Helado")._id), qty: 3 }], "efectivo", "en_camino", 45, "La Puntilla, Edif. Río Plaza, torre B", "agente");
  await mkOrder("UIO", "retiro", { name: "Marco Terán", phone: "0984445566" }, [{ product: String(Pn("Cazuela Mixta")._id), qty: 2 }], "local", "entregado", 150);
  await mkOrder("GYE-URD", "retiro", { name: "Paola Vinueza", phone: "0995556677" }, [{ product: String(Pn("Picudo Frito")._id), qty: 1, options: [{ name: "Preparación", choice: "Grill" }, { name: "Guarniciones (2)", choice: "Arroz" }, { name: "Guarniciones (2)", choice: "Patacones" }] }, { product: String(Pn("Ceviche Jipijapa de Pescado")._id), qty: 1 }], "local", "aceptado", 9);

  const cron = await runDailyCron();
  await AuditEvent.create({ user: U("admin")._id, userName: U("admin").name, role: "admin", action: "seed", entityType: "Sistema", entityLabel: "Datos de demostración cargados", at: new Date() });

  console.log(`\n[seed] listo. Alertas del cierre: ${cron.alerts}. Cuentas de prueba (clave para todas: ${PASSWORD}):`);
  for (const u of USERS) console.log(`  ${u.role.padEnd(13)} ${u.email.padEnd(32)} ${u.name}`);
  await mongoose.disconnect();
}

main().catch((err) => { console.error(err); process.exit(1); });

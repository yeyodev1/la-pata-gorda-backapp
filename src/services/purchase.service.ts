import { Types } from "mongoose";
import { Purchase } from "../models/purchase.model";
import { Supplier } from "../models/supplier.model";
import { Ingredient } from "../models/ingredient.model";
import { Branch } from "../models/branch.model";
import { nextNumber } from "../models/counter.model";
import { badRequest, conflict, notFound } from "../errors/httpError";
import { round2, round3 } from "../utils/numbers";
import { moveStock } from "./inventory.service";
import { audit } from "./audit.service";
import { AuthPayload } from "../middlewares/auth.middleware";

export async function createPurchase(auth: AuthPayload, body: { supplier?: string; branch?: string; items: { ingredient: string; qty: number; unitCost?: number }[]; expectedAt?: string; notes?: string; status?: "requerimiento" | "pedida" }) {
  if (!body.items?.length) throw badRequest("Agrega al menos un insumo");
  const supplier = body.supplier ? await Supplier.findById(body.supplier) : null;
  const branch = body.branch ? await Branch.findById(body.branch) : await Branch.findOne({ type: "bodega", active: true });
  if (!branch) throw badRequest("Indica dónde se recibe la compra (bodega)");
  const ings = await Ingredient.find({ _id: { $in: body.items.map((i) => new Types.ObjectId(i.ingredient)) } });
  const byId = new Map(ings.map((i) => [String(i._id), i]));
  const items = body.items.filter((i) => byId.has(i.ingredient) && Number(i.qty) > 0).map((i) => {
    const ing = byId.get(i.ingredient)!;
    return { ingredient: ing._id, ingredientName: ing.name, unit: ing.unit, qty: round3(Number(i.qty)), unitCost: round2(Number(i.unitCost ?? ing.cost) || 0), receivedQty: 0 };
  });
  if (!items.length) throw badRequest("Los insumos no son válidos");
  const purchase = await Purchase.create({ number: await nextNumber("COM"), supplier: supplier?._id ?? null, supplierName: supplier?.name ?? "", branch: branch._id, status: body.status ?? "requerimiento", items, total: round2(items.reduce((a, b) => a + b.qty * b.unitCost, 0)), expectedAt: body.expectedAt ?? "", notes: body.notes ?? "", createdBy: auth.name });
  await audit(auth, "crear_compra", { type: "Purchase", id: purchase._id, label: purchase.number }, { total: purchase.total });
  return purchase;
}

export async function updatePurchase(auth: AuthPayload, id: string, body: { supplier?: string; status?: string; items?: { ingredient: string; qty: number; unitCost?: number }[]; expectedAt?: string; notes?: string }) {
  const purchase = await Purchase.findById(id);
  if (!purchase) throw notFound("Compra no encontrada");
  if (["recibida", "anulada"].includes(purchase.status)) throw conflict(`La compra está ${purchase.status}`);
  if (body.supplier !== undefined) { const s = body.supplier ? await Supplier.findById(body.supplier) : null; purchase.supplier = s?._id ?? null; purchase.supplierName = s?.name ?? ""; }
  if (body.items) {
    const byId = new Map(body.items.map((i) => [i.ingredient, i]));
    for (const it of purchase.items) { const u = byId.get(String(it.ingredient)); if (u) { it.qty = round3(Number(u.qty) || 0); if (u.unitCost !== undefined) it.unitCost = round2(Number(u.unitCost) || 0); } }
    purchase.items = purchase.items.filter((it) => it.qty > 0);
    purchase.total = round2(purchase.items.reduce((a, b) => a + b.qty * b.unitCost, 0));
  }
  if (body.expectedAt !== undefined) purchase.expectedAt = body.expectedAt;
  if (body.notes !== undefined) purchase.notes = body.notes;
  if (body.status === "pedida" || body.status === "anulada") purchase.status = body.status;
  await purchase.save();
  await audit(auth, "editar_compra", { type: "Purchase", id: purchase._id, label: purchase.number }, { status: purchase.status });
  return purchase;
}

/** Recepción: entra a bodega lo que llegó y actualiza el costo de referencia del insumo. */
export async function receivePurchase(auth: AuthPayload, id: string, body: { items?: { ingredient: string; receivedQty: number; unitCost?: number }[]; invoiceNumber?: string }) {
  const purchase = await Purchase.findById(id);
  if (!purchase) throw notFound("Compra no encontrada");
  if (purchase.status === "recibida") throw conflict("La compra ya fue recibida");
  if (purchase.status === "anulada") throw conflict("La compra está anulada");
  const byId = new Map((body.items ?? []).map((i) => [i.ingredient, i]));
  for (const it of purchase.items) {
    const u = byId.get(String(it.ingredient));
    it.receivedQty = round3(u ? Math.max(0, Number(u.receivedQty) || 0) : it.qty);
    if (u?.unitCost !== undefined) it.unitCost = round2(Number(u.unitCost) || it.unitCost);
    if (it.receivedQty > 0) {
      await moveStock({ branch: purchase.branch, ingredient: it.ingredient, type: "ingreso", qty: it.receivedQty, refType: "Purchase", refId: purchase._id, note: `Compra ${purchase.number}${purchase.supplierName ? ` · ${purchase.supplierName}` : ""}`, userName: auth.name });
      if (it.unitCost > 0) await Ingredient.updateOne({ _id: it.ingredient }, { cost: it.unitCost });
    }
  }
  purchase.total = round2(purchase.items.reduce((a, b) => a + b.receivedQty * b.unitCost, 0));
  purchase.status = "recibida";
  purchase.receivedAt = new Date();
  if (body.invoiceNumber) purchase.invoiceNumber = body.invoiceNumber;
  await purchase.save();
  await audit(auth, "recibir_compra", { type: "Purchase", id: purchase._id, label: purchase.number }, { total: purchase.total });
  return purchase;
}

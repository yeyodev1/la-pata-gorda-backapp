import { Types } from "mongoose";
import { Branch, BRANCH_TYPES } from "../models/branch.model";
import { Category, Product } from "../models/product.model";
import { Ingredient, INGREDIENT_GROUPS, INGREDIENT_UNITS } from "../models/ingredient.model";
import { Supplier } from "../models/supplier.model";
import { badRequest, notFound, forbidden } from "../errors/httpError";
import { h, str } from "../utils/handler";
import { num } from "../utils/numbers";
import { audit } from "../services/audit.service";

function optionsFrom(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((o) => o && o.name).map((o) => ({ name: str(o.name), required: Boolean(o.required), max: Math.max(1, num(o.max, 1)), choices: Array.isArray(o.choices) ? o.choices.filter((c: { label?: string }) => c && c.label).map((c: { label: string; price?: number }) => ({ label: str(c.label), price: num(c.price) })) : [] })).filter((o) => o.choices.length);
}

function recipeFrom(raw: unknown) {
  if (!Array.isArray(raw)) return [];
  return raw.filter((l) => l && l.ingredient && num(l.qty) > 0).map((l) => ({ ingredient: new Types.ObjectId(String(l.ingredient)), qty: num(l.qty) }));
}

// ---------- Locales ----------
export const listBranches = h(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.type) filter.type = req.query.type;
  if (req.query.active !== "all") filter.active = true;
  res.json({ items: await Branch.find(filter).sort({ type: 1, order: 1, name: 1 }) });
});
export const createBranch = h(async (req, res) => {
  const { code, name, type, city, address, phone, capacity, hours, franchise, order } = req.body;
  if (!code || !name) throw badRequest("Código y nombre son obligatorios");
  if (type && !BRANCH_TYPES.includes(type)) throw badRequest("Tipo inválido");
  const branch = await Branch.create({ code: str(code), name: str(name), type: type ?? "local", city: str(city), address: str(address), phone: str(phone), capacity: num(capacity), hours: str(hours, "12:00-22:00"), franchise: Boolean(franchise), order: num(order), whatsapp: str(req.body.whatsapp), mapsUrl: str(req.body.mapsUrl), deliveryFee: num(req.body.deliveryFee, 2.5), prepMinutes: num(req.body.prepMinutes, 25) });
  await audit(req.auth, "crear_local", { type: "Branch", id: branch._id, label: branch.name });
  res.status(201).json({ branch });
});
export const updateBranch = h(async (req, res) => {
  const branch = await Branch.findById(req.params.id);
  if (!branch) throw notFound("Local no encontrado");
  const b = req.body;
  for (const k of ["code", "name", "city", "address", "phone", "hours"] as const) if (b[k] !== undefined) branch[k] = str(b[k]);
  if (b.type !== undefined) { if (!BRANCH_TYPES.includes(b.type)) throw badRequest("Tipo inválido"); branch.type = b.type; }
  if (b.capacity !== undefined) branch.capacity = num(b.capacity);
  if (b.order !== undefined) branch.order = num(b.order);
  if (b.franchise !== undefined) branch.franchise = Boolean(b.franchise);
  for (const k of ["pickupEnabled", "deliveryEnabled"] as const) if (b[k] !== undefined) branch[k] = Boolean(b[k]);
  for (const k of ["deliveryFee", "minOrder", "prepMinutes", "deliveryRadiusKm"] as const) if (b[k] !== undefined) branch[k] = num(b[k]);
  if (b.lat !== undefined) branch.lat = b.lat === null || b.lat === "" ? null : num(b.lat);
  if (b.lng !== undefined) branch.lng = b.lng === null || b.lng === "" ? null : num(b.lng);
  for (const k of ["whatsapp", "mapsUrl"] as const) if (b[k] !== undefined) branch[k] = str(b[k]);
  if (Array.isArray(b.privateTables)) branch.privateTables = b.privateTables.filter((t: { name?: string }) => t && t.name).map((t: { name: string; capacity?: number }) => ({ name: str(t.name), capacity: num(t.capacity, 10) }));
  if (b.active !== undefined) branch.active = Boolean(b.active);
  await branch.save();
  await audit(req.auth, "editar_local", { type: "Branch", id: branch._id, label: branch.name });
  res.json({ branch });
});

// ---------- Categorías y menú ----------
export const listCategories = h(async (_req, res) => {
  res.json({ items: await Category.find().sort({ order: 1, name: 1 }) });
});
export const saveCategory = h(async (req, res) => {
  const { name, order, active } = req.body;
  if (!name) throw badRequest("Nombre obligatorio");
  const cat = req.params.id ? await Category.findById(req.params.id) : new Category();
  if (!cat) throw notFound("Categoría no encontrada");
  cat.name = str(name); if (order !== undefined) cat.order = num(order); if (active !== undefined) cat.active = Boolean(active);
  await cat.save();
  res.json({ category: cat });
});
export const listProducts = h(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.category) filter.category = req.query.category;
  if (req.query.active !== "all") filter.active = true;
  if (req.query.q) filter.name = { $regex: String(req.query.q), $options: "i" };
  const items = await Product.find(filter).populate("category", "name order").populate("recipe.ingredient", "name unit cost").sort({ name: 1 });
  res.json({ items });
});
export const getProduct = h(async (req, res) => {
  const product = await Product.findById(req.params.id).populate("category", "name").populate("recipe.ingredient", "name unit cost producedInHouse");
  if (!product) throw notFound("Producto no encontrado");
  res.json({ product });
});
export const createProduct = h(async (req, res) => {
  const { code, name, category, description, price, image, recipe, featured } = req.body;
  if (!name || !category || price === undefined) throw badRequest("Nombre, categoría y precio son obligatorios");
  const product = await Product.create({ code: str(code) || `P-${Date.now().toString(36).toUpperCase()}`, name: str(name), category: new Types.ObjectId(String(category)), description: str(description), price: num(price), image: str(image), recipe: recipeFrom(recipe), featured: Boolean(featured), options: optionsFrom(req.body.options), online: req.body.online === undefined ? true : Boolean(req.body.online) });
  await audit(req.auth, "crear_producto", { type: "Product", id: product._id, label: product.name });
  res.status(201).json({ product });
});
export const updateProduct = h(async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) throw notFound("Producto no encontrado");
  const b = req.body;
  if (b.code !== undefined) product.code = str(b.code);
  if (b.name !== undefined) product.name = str(b.name);
  if (b.category !== undefined) product.category = new Types.ObjectId(String(b.category));
  if (b.description !== undefined) product.description = str(b.description);
  if (b.price !== undefined) product.price = num(b.price);
  if (b.image !== undefined) product.image = str(b.image);
  if (b.recipe !== undefined) product.recipe = recipeFrom(b.recipe);
  if (b.featured !== undefined) product.featured = Boolean(b.featured);
  if (b.online !== undefined) product.online = Boolean(b.online);
  if (b.options !== undefined) product.options = optionsFrom(b.options);
  if (b.active !== undefined) product.active = Boolean(b.active);
  if (b.excludedBranches !== undefined) product.excludedBranches = (b.excludedBranches as string[]).map((x) => new Types.ObjectId(x));
  await product.save();
  await audit(req.auth, "editar_producto", { type: "Product", id: product._id, label: product.name }, { price: product.price, recipe: product.recipe.length });
  res.json({ product });
});

// ---------- Insumos ----------
export const listIngredients = h(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.group) filter.group = req.query.group;
  if (req.query.producedInHouse !== undefined) filter.producedInHouse = req.query.producedInHouse === "true";
  if (req.query.active !== "all") filter.active = true;
  res.json({ items: await Ingredient.find(filter).populate("supplier", "name").populate("recipe.ingredient", "name unit").sort({ group: 1, name: 1 }) });
});
export const createIngredient = h(async (req, res) => {
  const { code, name, group, unit, cost, producedInHouse, recipe, minStock, shelfLifeDays, supplier } = req.body;
  if (!name) throw badRequest("Nombre obligatorio");
  if (group && !INGREDIENT_GROUPS.includes(group)) throw badRequest("Grupo inválido");
  if (unit && !INGREDIENT_UNITS.includes(unit)) throw badRequest("Unidad inválida");
  const ing = await Ingredient.create({ code: str(code) || `I-${Date.now().toString(36).toUpperCase()}`, name: str(name), group: group ?? "otros", unit: unit ?? "un", cost: num(cost), producedInHouse: Boolean(producedInHouse), recipe: recipeFrom(recipe), minStock: num(minStock), shelfLifeDays: num(shelfLifeDays), supplier: supplier ? new Types.ObjectId(String(supplier)) : null });
  await audit(req.auth, "crear_insumo", { type: "Ingredient", id: ing._id, label: ing.name });
  res.status(201).json({ ingredient: ing });
});
export const updateIngredient = h(async (req, res) => {
  const ing = await Ingredient.findById(req.params.id);
  if (!ing) throw notFound("Insumo no encontrado");
  const b = req.body;
  if (b.code !== undefined) ing.code = str(b.code);
  if (b.name !== undefined) ing.name = str(b.name);
  if (b.group !== undefined) { if (!INGREDIENT_GROUPS.includes(b.group)) throw badRequest("Grupo inválido"); ing.group = b.group; }
  if (b.unit !== undefined) { if (!INGREDIENT_UNITS.includes(b.unit)) throw badRequest("Unidad inválida"); ing.unit = b.unit; }
  if (b.cost !== undefined) ing.cost = num(b.cost);
  if (b.producedInHouse !== undefined) ing.producedInHouse = Boolean(b.producedInHouse);
  if (b.recipe !== undefined) ing.recipe = recipeFrom(b.recipe).filter((l) => String(l.ingredient) !== String(ing._id));
  if (b.minStock !== undefined) ing.minStock = num(b.minStock);
  if (b.shelfLifeDays !== undefined) ing.shelfLifeDays = num(b.shelfLifeDays);
  if (b.supplier !== undefined) ing.supplier = b.supplier ? new Types.ObjectId(String(b.supplier)) : null;
  if (b.active !== undefined) ing.active = Boolean(b.active);
  await ing.save();
  await audit(req.auth, "editar_insumo", { type: "Ingredient", id: ing._id, label: ing.name });
  res.json({ ingredient: ing });
});

// ---------- Proveedores ----------
export const listSuppliers = h(async (req, res) => {
  const filter: Record<string, unknown> = req.query.active === "all" ? {} : { active: true };
  res.json({ items: await Supplier.find(filter).sort({ name: 1 }) });
});
export const createSupplier = h(async (req, res) => {
  const { name, contact, phone, email, categories, creditDays, notes } = req.body;
  if (!name) throw badRequest("Nombre obligatorio");
  const s = await Supplier.create({ name: str(name), contact: str(contact), phone: str(phone), email: str(email), categories: Array.isArray(categories) ? categories : [], creditDays: num(creditDays), notes: str(notes) });
  await audit(req.auth, "crear_proveedor", { type: "Supplier", id: s._id, label: s.name });
  res.status(201).json({ supplier: s });
});
export const updateSupplier = h(async (req, res) => {
  const s = await Supplier.findById(req.params.id);
  if (!s) throw notFound("Proveedor no encontrado");
  const b = req.body;
  for (const k of ["name", "contact", "phone", "email", "notes"] as const) if (b[k] !== undefined) s[k] = str(b[k]);
  if (b.categories !== undefined) s.categories = Array.isArray(b.categories) ? b.categories : [];
  if (b.creditDays !== undefined) s.creditDays = num(b.creditDays);
  if (b.active !== undefined) s.active = Boolean(b.active);
  await s.save();
  res.json({ supplier: s });
});

/** Un administrador de local solo puede tocar su propio local. */
export function assertBranchAccess(auth: { role: string; branch: string | null } | undefined, branchId: string) {
  if (!auth) throw forbidden();
  if (auth.role === "local" && auth.branch !== branchId) throw forbidden("Solo puedes operar tu local");
}

import bcrypt from "bcryptjs";
import { Types } from "mongoose";
import { User, publicUser } from "../models/user.model";
import { USER_ROLES } from "../utils/roles";
import { badRequest, notFound } from "../errors/httpError";
import { h, str } from "../utils/handler";
import { audit } from "../services/audit.service";

export const listUsers = h(async (req, res) => {
  const filter: Record<string, unknown> = {};
  if (req.query.role) filter.role = req.query.role;
  if (req.query.active !== undefined) filter.active = req.query.active === "true";
  const users = await User.find(filter).sort({ role: 1, name: 1 });
  res.json({ items: users.map(publicUser) });
});

export const createUser = h(async (req, res) => {
  const { name, email, password, role, branch, phone } = req.body;
  if (!name || !email || !password || !role) throw badRequest("Nombre, correo, contraseña y rol son obligatorios");
  if (!USER_ROLES.includes(role)) throw badRequest("Rol inválido");
  if (role === "local" && !branch) throw badRequest("Un administrador de local necesita un local asignado");
  const user = await User.create({
    name: str(name),
    email: str(email).toLowerCase(),
    passwordHash: await bcrypt.hash(password, 10),
    role,
    branch: branch ? new Types.ObjectId(String(branch)) : null,
    phone: str(phone),
    createdBy: new Types.ObjectId(req.auth!.sub),
  });
  await audit(req.auth, "crear_usuario", { type: "User", id: user._id, label: user.email }, { role });
  res.status(201).json({ user: publicUser(user) });
});

export const updateUser = h(async (req, res) => {
  const user = await User.findById(req.params.id);
  if (!user) throw notFound("Usuario no encontrado");
  const { name, email, role, branch, phone, active, password } = req.body;
  if (name) user.name = str(name);
  if (email) user.email = str(email).toLowerCase();
  if (role) {
    if (!USER_ROLES.includes(role)) throw badRequest("Rol inválido");
    user.role = role;
  }
  if (branch !== undefined) user.branch = branch ? new Types.ObjectId(String(branch)) : null;
  if (phone !== undefined) user.phone = str(phone);
  if (active !== undefined) user.active = Boolean(active);
  if (password) user.passwordHash = await bcrypt.hash(password, 10);
  await user.save();
  await audit(req.auth, "editar_usuario", { type: "User", id: user._id, label: user.email }, { role: user.role, active: user.active });
  res.json({ user: publicUser(user) });
});

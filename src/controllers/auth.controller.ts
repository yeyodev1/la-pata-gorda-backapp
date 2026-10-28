import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { User, publicUser } from "../models/user.model";
import { badRequest, unauthorized } from "../errors/httpError";
import { h } from "../utils/handler";
import { audit } from "../services/audit.service";

export const login = h(async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) throw badRequest("Correo y contraseña son obligatorios");
  const user = await User.findOne({ email: email.toLowerCase().trim(), active: true });
  if (!user || !(await bcrypt.compare(password, user.passwordHash))) throw unauthorized("Credenciales incorrectas");
  user.lastLoginAt = new Date();
  await user.save();
  const payload = { sub: user._id.toString(), name: user.name, role: user.role, branch: user.branch ? String(user.branch) : null };
  const token = jwt.sign(payload, env.JWT_SECRET, { expiresIn: env.JWT_EXPIRES_IN } as jwt.SignOptions);
  await audit(payload, "login", { type: "User", id: user._id, label: user.email });
  res.json({ token, user: publicUser(user) });
});

export const me = h(async (req, res) => {
  const user = await User.findById(req.auth!.sub);
  if (!user || !user.active) throw unauthorized();
  res.json({ user: publicUser(user) });
});

export const changePassword = h(async (req, res) => {
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) throw badRequest("Faltan datos");
  if (newPassword.length < 6) throw badRequest("La nueva contraseña debe tener al menos 6 caracteres");
  const user = await User.findById(req.auth!.sub);
  if (!user || !(await bcrypt.compare(currentPassword, user.passwordHash))) throw unauthorized("Contraseña actual incorrecta");
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  await user.save();
  res.json({ ok: true });
});

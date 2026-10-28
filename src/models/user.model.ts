import mongoose, { Schema, Types } from "mongoose";
import { USER_ROLES, UserRole } from "../utils/roles";

export interface IUser {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  /** Administradores de local: el local que manejan. */
  branch: Types.ObjectId | null;
  phone: string;
  active: boolean;
  lastLoginAt: Date | null;
  createdBy: Types.ObjectId | null;
  createdAt?: Date;
  updatedAt?: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: USER_ROLES, required: true },
    branch: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    phone: { type: String, default: "", trim: true },
    active: { type: Boolean, default: true },
    lastLoginAt: { type: Date, default: null },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

export const User = (mongoose.models.User as mongoose.Model<IUser>) || mongoose.model<IUser>("User", userSchema);

export function publicUser(u: { _id: Types.ObjectId; name: string; email: string; role: UserRole; branch: Types.ObjectId | null; phone: string; active: boolean }) {
  return { id: u._id, name: u.name, email: u.email, role: u.role, branch: u.branch, phone: u.phone, active: u.active };
}

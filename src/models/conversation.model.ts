import mongoose, { Schema, Types } from "mongoose";

export const CONVERSATION_STATUSES = ["abierta", "esperando", "cerrada"] as const;
export type ConversationStatus = (typeof CONVERSATION_STATUSES)[number];
export const CONVERSATION_TOPICS = ["reserva", "pedido", "queja", "consulta", "evento", "otro"] as const;

export interface IMessage {
  direction: "entrante" | "saliente";
  text: string;
  /** Quién respondió (persona o "agente"). */
  by: string;
  at: Date;
}

/** Conversación con un cliente por WhatsApp (número único de la cadena). */
export interface IConversation {
  phone: string;
  name: string;
  branch: Types.ObjectId | null;
  topic: string;
  status: ConversationStatus;
  assignedTo: string;
  messages: IMessage[];
  lastMessageAt: Date;
  lastText: string;
  unread: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const messageSchema = new Schema<IMessage>({ direction: { type: String, enum: ["entrante", "saliente"], required: true }, text: { type: String, required: true }, by: { type: String, default: "" }, at: { type: Date, default: Date.now } });

const conversationSchema = new Schema<IConversation>(
  {
    phone: { type: String, required: true, index: true },
    name: { type: String, default: "" },
    branch: { type: Schema.Types.ObjectId, ref: "Branch", default: null },
    topic: { type: String, enum: CONVERSATION_TOPICS, default: "consulta" },
    status: { type: String, enum: CONVERSATION_STATUSES, default: "abierta", index: true },
    assignedTo: { type: String, default: "" },
    messages: { type: [messageSchema], default: [] },
    lastMessageAt: { type: Date, default: Date.now, index: true },
    lastText: { type: String, default: "" },
    unread: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const Conversation = (mongoose.models.Conversation as mongoose.Model<IConversation>) || mongoose.model<IConversation>("Conversation", conversationSchema);

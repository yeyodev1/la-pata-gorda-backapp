import axios, { AxiosError } from "axios";
import { env } from "../config/env";
import { HttpError } from "../errors/httpError";

/**
 * Payphone (Ecuador). Dos flujos, mismas credenciales:
 * - Cajita de Pagos (tienda nueva): el navegador muestra el formulario dentro de la vista de pago.
 * - Botón por redirección (link para WhatsApp y tienda anterior): Prepare devuelve la URL de pago.
 * En ambos el resultado solo se da por bueno al confirmarlo aquí, servidor a servidor, en menos de
 * 5 minutos; si no se confirma, Payphone reversa la transacción.
 * Docs: https://docs.payphone.app/cajita-de-pagos y /boton-de-pago
 */
export type PayphoneFlow = "box" | "button";

export const PAYPHONE_APPROVED = 3;
export const PAYPHONE_CANCELLED = 2;

export function payphoneConfigured(): boolean {
  return Boolean(env.PAYPHONE_TOKEN && env.PAYPHONE_STORE_ID);
}

/** Separa base e IVA a partir del total en centavos: los precios del menú ya incluyen IVA. */
export function amounts(totalUsd: number) {
  const amount = Math.round(totalUsd * 100);
  const amountWithTax = Math.round(amount / (1 + env.PAYPHONE_IVA_RATE));
  return { amount, amountWithTax, amountWithoutTax: 0, tax: amount - amountWithTax, service: 0, tip: 0, currency: "USD" as const };
}

/** Payphone pide el teléfono como +593984111222. */
export function toE164(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (phone.trim().startsWith("+")) return `+${digits}`;
  if (digits.startsWith("593")) return `+${digits}`;
  if (digits.startsWith("0")) return `+593${digits.slice(1)}`;
  return digits.length === 10 ? `+1${digits}` : `+593${digits}`;
}

export interface PayphoneConfirmation { ok: boolean; statusCode: number; transactionId: string; clientTransactionId: string; amount: number; authorizationCode: string; cardBrand: string; lastDigits: string; message: string }

async function callConfirm(url: string, id: number, clientTxId: string): Promise<PayphoneConfirmation> {
  try {
    const { data } = await axios.post(url, { id, clientTxId }, { headers: { Authorization: `Bearer ${env.PAYPHONE_TOKEN}`, "Content-Type": "application/json" }, timeout: 20000 });
    return { ok: Number(data.statusCode) === PAYPHONE_APPROVED, statusCode: Number(data.statusCode), transactionId: String(data.transactionId ?? ""), clientTransactionId: String(data.clientTransactionId ?? ""), amount: Number(data.amount ?? 0), authorizationCode: String(data.authorizationCode ?? ""), cardBrand: String(data.cardBrand ?? ""), lastDigits: String(data.lastDigits ?? ""), message: String(data.message ?? "") };
  } catch (error) {
    const status = error instanceof AxiosError ? error.response?.status : undefined;
    const detail = error instanceof AxiosError ? JSON.stringify(error.response?.data ?? error.message) : String(error);
    console.error("[payphone] confirm falló:", status, detail);
    // 4xx = la transacción no existe o no es de este comercio. Lo demás es una caída: se puede reintentar.
    if (status && status >= 400 && status < 500) throw new HttpError(400, "Payphone no reconoce esta transacción.");
    throw new HttpError(502, "No pudimos confirmar el pago con Payphone. Intenta de nuevo en un momento.");
  }
}

export function confirmPayment(flow: PayphoneFlow, id: number, clientTxId: string): Promise<PayphoneConfirmation> {
  return callConfirm(flow === "box" ? env.PAYPHONE_BOX_CONFIRM_URL : `${env.PAYPHONE_BUTTON_URL}/V2/Confirm`, id, clientTxId);
}

export async function preparePayment(input: { amountUsd: number; clientTransactionId: string; reference: string; responseUrl: string; storeId: string; email?: string; phone?: string }): Promise<{ url: string; paymentId: string }> {
  const { data } = await axios.post(
    `${env.PAYPHONE_BUTTON_URL}/Prepare`,
    { ...amounts(input.amountUsd), clientTransactionId: input.clientTransactionId, reference: input.reference, responseUrl: input.responseUrl, cancellationUrl: input.responseUrl, storeId: input.storeId, email: input.email || undefined, phoneNumber: input.phone ? toE164(input.phone) : undefined },
    { headers: { Authorization: `Bearer ${env.PAYPHONE_TOKEN}`, "Content-Type": "application/json" }, timeout: 15000 },
  );
  return { url: String(data.payWithCard ?? data.payWithPayPhone ?? ""), paymentId: String(data.paymentId ?? "") };
}

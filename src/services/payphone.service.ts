import axios from "axios";
import { env } from "../config/env";

/**
 * Payphone "Botón de pagos" (Ecuador): se prepara una transacción y se redirige al cliente a payWithCard;
 * al volver a responseUrl con ?id=&clientTransactionId= se confirma con V2/Confirm.
 * Docs: https://docs.payphone.app
 */
const BASE = "https://pay.payphonetodoesposible.com/api";

export function payphoneConfigured(): boolean {
  return Boolean(env.PAYPHONE_TOKEN && env.PAYPHONE_STORE_ID);
}

export async function preparePayment(input: { amountUsd: number; clientTransactionId: string; reference: string; responseUrl: string; email?: string; phone?: string }): Promise<{ url: string; paymentId: string }> {
  const cents = Math.round(input.amountUsd * 100);
  const { data } = await axios.post(
    `${BASE}/button/Prepare`,
    { amount: cents, amountWithoutTax: cents, amountWithTax: 0, tax: 0, service: 0, tip: 0, currency: "USD", clientTransactionId: input.clientTransactionId, reference: input.reference, responseUrl: input.responseUrl, cancellationUrl: input.responseUrl, storeId: env.PAYPHONE_STORE_ID, email: input.email ?? undefined, phoneNumber: input.phone ?? undefined },
    { headers: { Authorization: `Bearer ${env.PAYPHONE_TOKEN}`, "Content-Type": "application/json" }, timeout: 15000 },
  );
  return { url: String(data.payWithCard ?? data.payWithPayPhone ?? ""), paymentId: String(data.paymentId ?? "") };
}

export async function confirmPayment(id: string, clientTxId: string): Promise<{ ok: boolean; statusCode: number; transactionId: string; raw: unknown }> {
  const { data } = await axios.post(`${BASE}/button/V2/Confirm`, { id: Number(id), clientTxId }, { headers: { Authorization: `Bearer ${env.PAYPHONE_TOKEN}`, "Content-Type": "application/json" }, timeout: 15000 });
  // statusCode 3 = Approved, 2 = Canceled
  return { ok: Number(data.statusCode) === 3, statusCode: Number(data.statusCode), transactionId: String(data.transactionId ?? ""), raw: data };
}

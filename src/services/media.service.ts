/**
 * Fotos con Cloudinary. El navegador sube directo a Cloudinary; la API solo firma los parámetros
 * con el API secret. Las URLs se guardan con f_auto,q_auto para que pesen poco en la tienda.
 */
import { createHash } from "crypto";
import { env } from "../config/env";

const FOLDER = "la-pata-gorda";

export function mediaConfigured(): boolean {
  return Boolean(env.CLOUDINARY_CLOUD_NAME && env.CLOUDINARY_API_KEY && env.CLOUDINARY_API_SECRET);
}

export function signUpload(input: { folder?: string; publicId?: string; tags?: string[] }) {
  if (!mediaConfigured()) throw new Error("Cloudinary no está configurado en el servidor");
  const timestamp = Math.floor(Date.now() / 1000);
  const params: Record<string, string> = { folder: `${FOLDER}/${(input.folder ?? "general").replace(/[^a-z0-9_/-]/gi, "")}`, timestamp: String(timestamp) };
  if (input.publicId) params.public_id = input.publicId.replace(/[^a-z0-9_-]/gi, "");
  if (input.tags?.length) params.tags = input.tags.join(",");
  const toSign = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join("&");
  const signature = createHash("sha1").update(toSign + env.CLOUDINARY_API_SECRET).digest("hex");
  return { cloudName: env.CLOUDINARY_CLOUD_NAME, apiKey: env.CLOUDINARY_API_KEY, uploadUrl: `https://api.cloudinary.com/v1_1/${env.CLOUDINARY_CLOUD_NAME}/image/upload`, params: { ...params, signature, api_key: env.CLOUDINARY_API_KEY } };
}

/** URL optimizada (formato y calidad automáticos, ancho máximo). */
export function optimized(url: string, width = 900): string {
  if (!url.includes("res.cloudinary.com") || url.includes("/upload/f_auto")) return url;
  return url.replace("/upload/", `/upload/f_auto,q_auto,w_${width},c_limit/`);
}

/** Subida desde el servidor por URL (migración de fotos externas). */
export async function uploadFromUrl(sourceUrl: string, publicId: string, folder = "menu"): Promise<{ url: string; publicId: string }> {
  const sig = signUpload({ folder, publicId });
  const form = new URLSearchParams({ ...sig.params, file: sourceUrl });
  const res = await fetch(sig.uploadUrl, { method: "POST", body: form });
  const data = (await res.json()) as { secure_url?: string; public_id?: string; error?: { message?: string } };
  if (!res.ok || !data.secure_url) throw new Error(data.error?.message ?? `Cloudinary ${res.status}`);
  return { url: optimized(data.secure_url), publicId: data.public_id ?? publicId };
}

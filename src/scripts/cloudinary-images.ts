/**
 * Migra las fotos del menú (URLs de Uber Eats) a Cloudinary y guarda la URL optimizada.
 *   npx ts-node-dev --transpile-only src/scripts/cloudinary-images.ts
 */
import mongoose from "mongoose";
import { dbConnect } from "../config/mongo";
import { Product } from "../models/product.model";
import { uploadFromUrl, mediaConfigured } from "../services/media.service";

async function main() {
  if (!mediaConfigured()) throw new Error("Faltan credenciales de Cloudinary en .env");
  await dbConnect();
  const products = await Product.find({ image: { $regex: "^https?://", $options: "i" }, $nor: [{ image: { $regex: "res\\.cloudinary\\.com" } }] });
  console.log(`[cloudinary] ${products.length} fotos por migrar`);
  let ok = 0;
  for (const p of products) {
    try {
      const r = await uploadFromUrl(p.image, p.code.toLowerCase());
      p.image = r.url;
      await p.save();
      ok++;
      console.log(`  ✓ ${p.name}`);
    } catch (err) {
      console.log(`  ✗ ${p.name}: ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`[cloudinary] listo: ${ok}/${products.length}`);
  await mongoose.disconnect();
}
main().catch((err) => { console.error(err); process.exit(1); });

import { createApp } from "./app";
import { dbConnect } from "./config/mongo";
import { env } from "./config/env";

async function main() {
  await dbConnect();
  console.log("[mongo] conectado");
  const { server } = createApp();
  server.listen(env.PORT, () => {
    console.log(`[api] escuchando en http://localhost:${env.PORT}`);
  });
  // Cierre diario en Node (01:00 Ecuador). En Cloudflare lo hace el Cron Trigger.
  let lastCronDay = "";
  setInterval(async () => {
    const ec = new Date(Date.now() - 5 * 3600 * 1000);
    const day = ec.toISOString().slice(0, 10);
    if (ec.getUTCHours() === 1 && lastCronDay !== day) {
      lastCronDay = day;
      try {
        const { runDailyCron } = await import("./services/cron.service");
        console.log("[cron] cierre diario:", await runDailyCron());
      } catch (err) {
        console.error("[cron] falló", err);
      }
    }
  }, 60 * 1000);
}

main().catch((err) => {
  console.error("No se pudo iniciar el servidor", err);
  process.exit(1);
});

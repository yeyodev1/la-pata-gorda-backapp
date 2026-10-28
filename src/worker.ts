/**
 * Punto de entrada para Cloudflare Workers.
 * La misma app Express 5 corre dentro de un Durable Object: así la conexión a MongoDB se conserva
 * entre peticiones (en un Worker normal el socket no sobrevive de una petición a otra).
 * El Worker de entrada reenvía cada petición a una instancia única por versión desplegada.
 */
import { DurableObject } from "cloudflare:workers";
import { httpServerHandler } from "cloudflare:node";
import mongoose from "mongoose";
import { createApp } from "./app";
import { resetDbForNewContext } from "./config/mongo";

interface Env {
  API: DurableObjectNamespace;
  CRON_KEY?: string;
  CF_VERSION_METADATA?: { id: string; tag?: string };
  DO_LOCATION_HINT?: string;
}

const PORT = 8787;

export class PataGordaApi extends DurableObject<Env> {
  private handler: ReturnType<typeof httpServerHandler>;

  constructor(ctx: ConstructorParameters<typeof DurableObject<Env>>[0], env: Env) {
    super(ctx, env);
    mongoose.set("bufferCommands", false);
    ctx.blockConcurrencyWhile(() => resetDbForNewContext());
    const { server } = createApp({ lazyDb: true });
    server.listen(PORT);
    this.handler = httpServerHandler({ port: PORT });
  }

  override fetch(request: Request): Promise<Response> {
    return this.handler.fetch(request, this.env, this.ctx);
  }
}

function apiStub(env: Env) {
  const id = env.API.idFromName(`api-${env.CF_VERSION_METADATA?.id ?? "v1"}`);
  return env.API.get(id, { locationHint: env.DO_LOCATION_HINT || "enam" });
}

export default {
  /** Cron Trigger: 06:00 UTC = 01:00 Ecuador. Cierre diario. */
  scheduled(_event: unknown, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }) {
    ctx.waitUntil(apiStub(env).fetch(new Request("https://la-pata-gorda-api.internal/internal/cron/daily", { method: "POST", headers: { "x-internal-key": env.CRON_KEY ?? "" } })));
  },
  fetch(request: Request, env: Env): Promise<Response> {
    return apiStub(env).fetch(request);
  },
};

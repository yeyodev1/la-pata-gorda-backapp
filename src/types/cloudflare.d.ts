/**
 * Tipos mínimos de los módulos de Cloudflare Workers que usa src/worker.ts.
 * Evitamos instalar @cloudflare/workers-types completo para no mezclar sus globales con @types/node.
 */
declare module "cloudflare:node" {
  export function httpServerHandler(options: { port: number }): {
    fetch(request: Request, env?: unknown, ctx?: unknown): Promise<Response>;
  };
}

declare module "cloudflare:workers" {
  export class DurableObject<Env = unknown> {
    constructor(ctx: DurableObjectState, env: Env);
    protected ctx: DurableObjectState;
    protected env: Env;
    fetch(request: Request): Promise<Response> | Response;
    alarm?(): Promise<void> | void;
  }
  export interface DurableObjectState {
    id: { toString(): string };
    waitUntil(promise: Promise<unknown>): void;
    blockConcurrencyWhile<T>(fn: () => Promise<T>): Promise<T>;
    storage: { setAlarm(scheduledTime: number | Date): Promise<void>; getAlarm(): Promise<number | null>; deleteAlarm(): Promise<void> };
  }
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown, options?: { locationHint?: string }): DurableObjectStub;
}

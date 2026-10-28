# La Pata Gorda · API

Backend del sistema de La Pata Gorda (cadena de restaurantes de cangrejo y mariscos, Guayaquil). Express 5 + Mongoose 9 + TypeScript, desplegado en Cloudflare Workers (Durable Object) con MongoDB Atlas.

## Qué hace
- **Tienda en línea** (`/public/*`): menú con fotos, pedidos para retiro o domicilio, seguimiento por link, pago con Payphone o al recibir, reservas con confirmación del local.
- **Pantalla de pedidos** por local (`/api/shop/*`): los pedidos llegan a la caja como "un Uber más".
- **Operación interna** (`/api/*`): locales, menú y recetas, inventario por local, cierre de ventas, pedidos de los locales al centro de producción con sugerencia automática (promedio por día de semana + seguridad), plan de producción, compras, reservas, WhatsApp, reseñas, alertas, reportes y asistente con Claude.
- **Integraciones** (`/integrations/*`, clave en `x-internal-key`): para el agente de WhatsApp, Google reviews y el POS.

## Correr en local
```bash
npm install
cp .env.example .env   # poner MONGODB_URI de Atlas
npm run seed           # datos de demostración (clave de todas las cuentas: patagorda2026)
npm run dev            # http://localhost:8400
```

## Desplegar en Cloudflare
```bash
npx wrangler secret put MONGODB_URI   # y JWT_SECRET, CRON_KEY, CLOUDINARY_*, PAYPHONE_*, ANTHROPIC_API_KEY
npm run cf:deploy
```
En Atlas → Network Access hay que permitir `0.0.0.0/0` (los Workers no tienen IP fija).

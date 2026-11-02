/**
 * Simulador local de Payphone para probar la tienda sin claves ni cobros reales. Nunca corre en producción.
 *   npx ts-node-dev --transpile-only src/scripts/payphone-sim.ts
 * API:    PAYPHONE_TOKEN=sim PAYPHONE_STORE_ID=sim PAYPHONE_BOX_CONFIRM_URL=http://localhost:8499/confirm
 * Tienda: VITE_PAYPHONE_BOX_JS=http://localhost:8499/box.js VITE_PAYPHONE_BOX_CSS=http://localhost:8499/box.css
 */
import http from "http";

const PORT = Number(process.env.PAYPHONE_SIM_PORT ?? 8499);
const txs = new Map<number, { clientTransactionId: string; amount: number; statusCode: number }>();
let nextId = 1000;

const BOX_JS = `window.PPaymentButtonBox = class {
  constructor(o) { this.o = o }
  render(id) {
    const o = this.o, el = document.getElementById(id);
    el.innerHTML = '<div class="pp-sim"><strong>Simulador de Payphone</strong><p>No es un cobro real. Monto: $' + (o.amount / 100).toFixed(2) + ' (base ' + (o.amountWithTax / 100).toFixed(2) + ' + IVA ' + (o.tax / 100).toFixed(2) + ')</p><button data-r="3">Aprobar</button> <button data-r="2">Rechazar</button></div>';
    el.querySelectorAll('button').forEach((b) => b.onclick = async () => {
      const r = await fetch('http://localhost:${PORT}/pay', { method: 'POST', body: JSON.stringify({ clientTransactionId: o.clientTransactionId, amount: o.amount, statusCode: Number(b.dataset.r) }) });
      const { id } = await r.json();
      location.href = location.origin + '/pago/resultado?id=' + id + '&clientTransactionId=' + encodeURIComponent(o.clientTransactionId);
    });
  }
};`;

http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") { res.end(); return; }
  if (req.url === "/box.js") { res.setHeader("Content-Type", "text/javascript"); res.end(BOX_JS); return; }
  if (req.url === "/box.css") { res.setHeader("Content-Type", "text/css"); res.end(".pp-sim{padding:16px;background:#fff;color:#111}.pp-sim button{min-height:48px;padding:0 20px;margin-top:8px}"); return; }
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    res.setHeader("Content-Type", "application/json");
    const body = raw ? JSON.parse(raw) : {};
    if (req.url === "/pay") { const id = nextId++; txs.set(id, body); res.end(JSON.stringify({ id })); return; }
    if (req.url === "/confirm") {
      const tx = txs.get(Number(body.id));
      if (!tx || tx.clientTransactionId !== body.clientTxId) { res.statusCode = 400; res.end(JSON.stringify({ message: "Transacción no existe", errorCode: 20 })); return; }
      res.end(JSON.stringify({ statusCode: tx.statusCode, transactionStatus: tx.statusCode === 3 ? "Approved" : "Canceled", clientTransactionId: tx.clientTransactionId, transactionId: Number(body.id), authorizationCode: "SIM123", amount: tx.amount, cardBrand: "Visa", lastDigits: "4242", message: tx.statusCode === 3 ? "" : "Tarjeta rechazada" }));
      return;
    }
    res.statusCode = 404; res.end("{}");
  });
}).listen(PORT, () => console.log(`[payphone-sim] http://localhost:${PORT}`));

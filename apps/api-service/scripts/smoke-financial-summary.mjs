/**
 * Smoke API: GET /api/financial/summary (resumo mensal por entregador).
 * Uso: node apps/api-service/scripts/smoke-financial-summary.mjs
 *   ou: npm run smoke:financial-summary (se configurado no package raiz)
 *
 * Requer:
 * - API_BASE_URL (default: http://localhost:3001)
 * - API_ADMIN_EMAIL + API_ADMIN_PASSWORD
 * Opcional: FINANCIAL_SUMMARY_DRIVER_ID (uuid); senão usa o primeiro driver de GET /api/drivers?limit=1
 */
const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
const email = process.env.API_ADMIN_EMAIL || '';
const password = process.env.API_ADMIN_PASSWORD || '';
const seedDriverId = process.env.FINANCIAL_SUMMARY_DRIVER_ID || '';

if (!email || !password) {
  console.log('SKIP_SMOKE_NO_API_CREDS — defina API_ADMIN_EMAIL e API_ADMIN_PASSWORD para smoke HTTP.');
  process.exit(0);
}

async function http(path, init = {}) {
  const res = await fetch(`${baseUrl}${path}`, init);
  const txt = await res.text();
  let body;
  try {
    body = txt ? JSON.parse(txt) : null;
  } catch {
    body = txt;
  }
  return { ok: res.ok, status: res.status, body };
}

function assert(condition, message, details) {
  if (condition) return;
  console.error(message, details || '');
  process.exit(1);
}

const login = await http('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});
assert(login.ok && login.body?.token, 'Smoke financial-summary falhou no login', login);

const token = login.body.token;
const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

let driverId = seedDriverId;
if (!driverId) {
  const drivers = await http('/api/drivers?limit=5', { headers: authHeaders });
  assert(drivers.ok && Array.isArray(drivers.body), 'Falha ao listar drivers', drivers);
  const first = (drivers.body || []).find((d) => d?.id);
  driverId = first?.id || '';
}

if (!driverId) {
  console.log('SKIP_SMOKE_NO_DRIVER — nenhum driver_id disponível (cadastre um entregador ou defina FINANCIAL_SUMMARY_DRIVER_ID).');
  process.exit(0);
}

const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const summary = await http(
  `/api/financial/summary?driver_id=${encodeURIComponent(driverId)}&month=${encodeURIComponent(month)}`,
  { headers: authHeaders }
);
assert(summary.ok && summary.body && summary.body.driver_id === driverId, 'Falha em GET /api/financial/summary', summary);
assert(typeof summary.body.total_debits === 'number', 'Resumo sem total_debits numérico', summary.body);
assert(typeof summary.body.total_paid === 'number', 'Resumo sem total_paid numérico', summary.body);

console.log('OK: smoke financial-summary concluído.', { driver_id: driverId, month: summary.body.month });

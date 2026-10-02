/**
 * Smoke API: GET /api/billing/capital-cooperativo/report
 * Uso: node apps/api-service/scripts/smoke-capital-cooperativo-report.mjs
 *
 * Requer:
 * - API_BASE_URL (default: http://localhost:3001)
 * - API_ADMIN_EMAIL + API_ADMIN_PASSWORD
 */
const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
const email = process.env.API_ADMIN_EMAIL || '';
const password = process.env.API_ADMIN_PASSWORD || '';

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
assert(login.ok && login.body?.token, 'Smoke capital-cooperativo falhou no login', login);

const token = login.body.token;
const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const now = new Date();
const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const reportRes = await http(
  `/api/billing/capital-cooperativo/report?month=${encodeURIComponent(month)}`,
  { headers: authHeaders }
);
assert(reportRes.ok && reportRes.body?.report, 'Falha em GET /api/billing/capital-cooperativo/report', reportRes);

const report = reportRes.body.report;
assert(report.month === month, 'Mês do relatório divergente', report);
assert(report.summary && typeof report.summary.net_movement_cents === 'number', 'Summary inválido', report.summary);
assert(Array.isArray(report.by_driver), 'by_driver deve ser array', report);
assert(Array.isArray(report.lines), 'lines deve ser array', report);

console.log('OK: smoke capital-cooperativo concluído.', {
  month: report.month,
  lines: report.lines.length,
  drivers: report.by_driver.length,
  net_movement_cents: report.summary.net_movement_cents,
});

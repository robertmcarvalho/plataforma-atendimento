/**
 * Smoke API: valida endpoints de métricas e alertas operacionais.
 * Uso: npm run smoke:metrics-alerts-api
 *
 * Requer:
 * - API_BASE_URL (default: http://localhost:3001)
 * - API_ADMIN_EMAIL
 * - API_ADMIN_PASSWORD
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

const login = await http('/api/auth/login', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email, password }),
});

if (!login.ok || !login.body?.token) {
  console.error('Smoke Metrics/Alerts falhou no login:', login.status, login.body);
  process.exit(1);
}

const token = login.body.token;
const authHeaders = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

const operational = await http('/api/reports/operational-kpis?period=7', { headers: authHeaders });
if (!operational.ok || typeof operational.body !== 'object') {
  console.error('Falha em /api/reports/operational-kpis:', operational.status, operational.body);
  process.exit(1);
}
for (const key of ['tickets_opened', 'tickets_resolved', 'sla_on_time_rate', 'escalation_rate', 'avg_handle_minutes']) {
  if (!(key in (operational.body || {}))) {
    console.error(`Resposta de operational-kpis sem campo obrigatório: ${key}`, operational.body);
    process.exit(1);
  }
}

const mcpSummary = await http('/api/mcp-metrics/summary?period=7', { headers: authHeaders });
if (!mcpSummary.ok || typeof mcpSummary.body !== 'object') {
  console.error('Falha em /api/mcp-metrics/summary:', mcpSummary.status, mcpSummary.body);
  process.exit(1);
}
for (const key of ['total_executions', 'error_rate', 'p50_ms', 'p95_ms', 'tools']) {
  if (!(key in (mcpSummary.body || {}))) {
    console.error(`Resposta de mcp-metrics/summary sem campo obrigatório: ${key}`, mcpSummary.body);
    process.exit(1);
  }
}

const alerts = await http('/api/mcp-metrics/alerts', { headers: authHeaders });
if (!alerts.ok || typeof alerts.body !== 'object') {
  console.error('Falha em /api/mcp-metrics/alerts:', alerts.status, alerts.body);
  process.exit(1);
}
for (const key of ['thresholds', 'values', 'alerts', 'has_critical']) {
  if (!(key in (alerts.body || {}))) {
    console.error(`Resposta de mcp-metrics/alerts sem campo obrigatório: ${key}`, alerts.body);
    process.exit(1);
  }
}

console.log('OK: smoke API metrics/alerts concluído.');

/**
 * Smoke API: valida endpoints de IA (topics + suggest-reply) e reports ai-summary.
 * Uso: npm run smoke:ai-api
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
assert(login.ok && login.body?.token, 'Smoke IA API falhou no login', login);

const token = login.body.token;
const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// Topics (não tem gate de IA; deve funcionar sempre com auth).
const topics = await http('/api/ai/topics', { headers: authHeaders });
assert(topics.ok && typeof topics.body === 'object' && Array.isArray(topics.body?.data), 'Falha em /api/ai/topics', topics);

// Reports ai-summary (admin/supervisor).
const aiSummary = await http('/api/reports/ai-summary?period=7', { headers: authHeaders });
assert(aiSummary.ok && typeof aiSummary.body === 'object' && aiSummary.body?.period_days !== undefined, 'Falha em /api/reports/ai-summary', aiSummary);

// Suggest-reply: pode ser 404 (uuid inexistente) OU 503/429 por gate/config/rate-limit.
const suggest = await http('/api/ai/suggest-reply', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({ conversation_id: '00000000-0000-0000-0000-000000000000' }),
});
if (![404, 429, 503].includes(suggest.status)) {
  console.error('Status inesperado em /api/ai/suggest-reply:', suggest.status, suggest.body);
  process.exit(1);
}

console.log('OK: smoke IA API concluído (topics + ai-summary + suggest-reply gate).');


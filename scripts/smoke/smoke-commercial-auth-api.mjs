/**
 * Smoke: autenticação + rotas comerciais protegidas.
 */
const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const email = process.env.API_ADMIN_EMAIL || process.env.SMOKE_EMAIL || '';
const password = process.env.API_ADMIN_PASSWORD || process.env.SMOKE_PASSWORD || '';

if (!email || !password) {
  console.log('SKIP_SMOKE_NO_API_CREDS — defina API_ADMIN_EMAIL e API_ADMIN_PASSWORD.');
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
assert(login.ok && login.body?.token, 'Falha no login comercial', login);
console.log('PASS: POST /api/auth/login');

const token = login.body.token;
const headers = { Authorization: `Bearer ${token}` };

const stages = await http('/api/commercial/pipeline-stages', { headers });
assert(stages.ok && Array.isArray(stages.body), 'GET /api/commercial/pipeline-stages falhou', stages);
console.log(`PASS: GET /api/commercial/pipeline-stages (${stages.body.length} estágios)`);

const leads = await http('/api/commercial/leads?limit=5', { headers });
assert(leads.ok && Array.isArray(leads.body?.data ?? leads.body), 'GET /api/commercial/leads falhou', leads);
console.log('PASS: GET /api/commercial/leads');

const unauth = await http('/api/commercial/leads');
assert(unauth.status === 401, 'Rota comercial deveria exigir auth', unauth);
console.log('PASS: commercial exige autenticação');

console.log('PASS: smoke-commercial-auth-api');

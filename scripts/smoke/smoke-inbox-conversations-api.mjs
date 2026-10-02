/**
 * Smoke: inbox conversations API (list + detail).
 * Requer API no ar. Credenciais: API_ADMIN_EMAIL + API_ADMIN_PASSWORD (ou API_BASE_URL).
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
assert(login.ok && login.body?.token, 'Falha no login', login);

const token = login.body.token;
const headers = { Authorization: `Bearer ${token}` };

const list = await http('/api/conversations?limit=5&page=1', { headers });
assert(list.ok && Array.isArray(list.body?.data), 'GET /api/conversations falhou', list);
console.log(`PASS: GET /api/conversations (${list.body.data.length} itens, total=${list.body.total ?? '?'})`);

const first = list.body.data[0];
if (first?.id) {
  const detail = await http(`/api/conversations/${first.id}`, { headers });
  assert(detail.ok && detail.body?.id === first.id, 'GET /api/conversations/:id falhou', detail);
  console.log(`PASS: GET /api/conversations/${first.id}`);
} else {
  console.log('SKIP: nenhuma conversa no workspace para testar GET /:id');
}

console.log('PASS: smoke-inbox-conversations-api');

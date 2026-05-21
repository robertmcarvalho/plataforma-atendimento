/**
 * Smoke API: valida endpoints de tickets e MCP.
 * Uso: npm run smoke:ticketing-mcp-api
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
  console.error('Smoke API falhou no login:', login.status, login.body);
  process.exit(1);
}

const token = login.body.token;
const authHeaders = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
};

const tools = await http('/api/mcp/tools', { headers: authHeaders });
if (!tools.ok || !Array.isArray(tools.body)) {
  console.error('Smoke API falhou em /api/mcp/tools:', tools.status, tools.body);
  process.exit(1);
}

const exec = await http('/api/mcp/execute', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({
    tool: 'mcp-audit',
    action: 'log_tool_execution',
    input: { smoke: true },
    context: {},
  }),
});
if (!exec.ok) {
  console.error('Smoke API falhou em /api/mcp/execute:', exec.status, exec.body);
  process.exit(1);
}

const openTicket = await http('/api/tickets/open-from-message', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({
    // intencionalmente invalido para validar contrato de erro controlado
    conversation_id: '00000000-0000-0000-0000-000000000000',
  }),
});

// Esperado aqui: erro 404 (mensagem nao encontrada) ou 500 em ambiente sem dados completos.
if (![404, 500].includes(openTicket.status)) {
  console.error('Smoke API ticket retornou status inesperado:', openTicket.status, openTicket.body);
  process.exit(1);
}

const listTickets = await http('/api/tickets', { headers: authHeaders });
if (!listTickets.ok || !Array.isArray(listTickets.body)) {
  console.error('Smoke API falhou em /api/tickets:', listTickets.status, listTickets.body);
  process.exit(1);
}

const executions = await http('/api/mcp/executions', { headers: authHeaders });
if (!executions.ok || !Array.isArray(executions.body)) {
  console.error('Smoke API falhou em /api/mcp/executions:', executions.status, executions.body);
  process.exit(1);
}

console.log('OK: smoke API tickets/mcp concluido.');

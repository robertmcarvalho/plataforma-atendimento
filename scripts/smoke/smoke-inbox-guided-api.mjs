/**
 * Smoke guiado (API) para Inbox.
 * Cobertura técnica dos cenários do documento:
 * - ciclo de ticket (status + timeline),
 * - MCP execute + auditoria,
 * - governança/rollout (settings),
 * - métricas/alertas operacionais.
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
assert(login.ok && login.body?.token, 'Falha no login do smoke guiado', login);

const token = login.body.token;
const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

// Cenário base: buscar ticket para transição.
const ticketList = await http('/api/tickets?limit=10', { headers: authHeaders });
assert(ticketList.ok && Array.isArray(ticketList.body), 'Falha ao listar tickets', ticketList);
const ticket = (ticketList.body || []).find((t) => t && t.id);
assert(Boolean(ticket?.id), 'Nenhum ticket disponível para smoke de transição.');

const timelineBefore = await http(`/api/tickets/${ticket.id}/timeline`, { headers: authHeaders });
assert(timelineBefore.ok && Array.isArray(timelineBefore.body), 'Falha ao buscar timeline inicial', timelineBefore);
const beforeCount = timelineBefore.body.length;

const setInProgress = await http(`/api/tickets/${ticket.id}`, {
  method: 'PATCH',
  headers: authHeaders,
  body: JSON.stringify({ status: 'in_progress' }),
});
assert(setInProgress.ok, 'Falha ao transicionar ticket para in_progress', setInProgress);

const setResolved = await http(`/api/tickets/${ticket.id}`, {
  method: 'PATCH',
  headers: authHeaders,
  body: JSON.stringify({ status: 'resolved' }),
});
assert(setResolved.ok, 'Falha ao transicionar ticket para resolved', setResolved);

const timelineAfter = await http(`/api/tickets/${ticket.id}/timeline`, { headers: authHeaders });
assert(timelineAfter.ok && Array.isArray(timelineAfter.body), 'Falha ao buscar timeline final', timelineAfter);
assert(timelineAfter.body.length >= beforeCount + 2, 'Timeline não refletiu as transições esperadas.', {
  beforeCount,
  afterCount: timelineAfter.body.length,
});

// MCP execução + auditoria
const mcpExec = await http('/api/mcp/execute', {
  method: 'POST',
  headers: authHeaders,
  body: JSON.stringify({
    tool: 'mcp-operacao',
    action: 'get_driver_context',
    input: {},
    context: { ticket_id: ticket.id },
  }),
});
assert(mcpExec.ok, 'Falha em MCP execute operacional', mcpExec);

const mcpExecutions = await http(`/api/mcp/executions?ticket_id=${encodeURIComponent(ticket.id)}&limit=20`, {
  headers: authHeaders,
});
assert(mcpExecutions.ok && Array.isArray(mcpExecutions.body), 'Falha em MCP executions', mcpExecutions);
assert(
  (mcpExecutions.body || []).some((row) => row?.payload?.tool === 'mcp-operacao'),
  'Não encontrou execução mcp-operacao na auditoria por ticket.',
  mcpExecutions.body
);

// Governança / rollout (configuração gravável)
const settingsRead = await http('/api/settings', { headers: authHeaders });
assert(settingsRead.ok && typeof settingsRead.body === 'object', 'Falha ao ler settings', settingsRead);
const prevRollout = settingsRead.body?.mcp_rollout_config || { enabled: false, pilot_tenants: [] };

const rolloutProbe = { enabled: false, pilot_tenants: [] };
const saveRollout = await http('/api/settings', {
  method: 'PUT',
  headers: authHeaders,
  body: JSON.stringify({ key: 'mcp_rollout_config', value: rolloutProbe }),
});
assert(saveRollout.ok, 'Falha ao salvar mcp_rollout_config (probe)', saveRollout);

const restoreRollout = await http('/api/settings', {
  method: 'PUT',
  headers: authHeaders,
  body: JSON.stringify({ key: 'mcp_rollout_config', value: prevRollout }),
});
assert(restoreRollout.ok, 'Falha ao restaurar mcp_rollout_config', restoreRollout);

// Métricas / alertas
const operationalKpis = await http('/api/reports/operational-kpis?period=7', { headers: authHeaders });
assert(operationalKpis.ok && operationalKpis.body?.tickets_opened !== undefined, 'Falha em operational-kpis', operationalKpis);

const mcpMetrics = await http('/api/mcp-metrics/summary?period=7', { headers: authHeaders });
assert(mcpMetrics.ok && mcpMetrics.body?.total_executions !== undefined, 'Falha em mcp-metrics/summary', mcpMetrics);

const mcpAlerts = await http('/api/mcp-metrics/alerts', { headers: authHeaders });
assert(mcpAlerts.ok && typeof mcpAlerts.body?.has_critical === 'boolean', 'Falha em mcp-metrics/alerts', mcpAlerts);

console.log('OK: smoke guiado da Inbox (API) concluído.');

#!/usr/bin/env node
/**
 * Smoke: /api/ops-analytics (portfolio, hub, execution-board, tasks, coordination, RBAC).
 * Uso: API_URL=http://localhost:3001 node scripts/smoke-ops-analytics-api.mjs
 */
const API_URL = (process.env.API_URL || 'http://localhost:3001').replace(/\/$/, '');

async function login(email, password) {
  const res = await fetch(`${API_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`login ${email}: ${res.status} ${JSON.stringify(body)}`);
  return body.token;
}

async function get(path, token) {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function main() {
  const attendantEmail = process.env.SMOKE_ATTENDANT_EMAIL;
  const attendantPassword = process.env.SMOKE_ATTENDANT_PASSWORD;
  const supervisorEmail = process.env.SMOKE_SUPERVISOR_EMAIL || process.env.SMOKE_ADMIN_EMAIL;
  const supervisorPassword = process.env.SMOKE_SUPERVISOR_PASSWORD || process.env.SMOKE_ADMIN_PASSWORD;

  if (!attendantEmail || !attendantPassword) {
    console.log('skip: defina SMOKE_ATTENDANT_EMAIL e SMOKE_ATTENDANT_PASSWORD');
    process.exit(0);
  }

  const attendantToken = await login(attendantEmail, attendantPassword);
  const portfolio = await get('/api/ops-analytics/portfolio?period=30', attendantToken);
  assert(portfolio.status === 200, `portfolio attendant: ${portfolio.status}`);
  assert(Array.isArray(portfolio.body.pharmacies), 'portfolio.pharmacies array');
  console.log('ok portfolio', portfolio.body.totals);

  const launch = await get('/api/ops-analytics/portfolio/launch-context', attendantToken);
  assert(launch.status === 200, `launch-context: ${launch.status}`);

  const hub = await get('/api/ops-analytics/portfolio/hub?period=30', attendantToken);
  assert(hub.status === 200, `portfolio/hub: ${hub.status}`);
  assert(Array.isArray(hub.body.tasks), 'hub.tasks array');
  if (hub.body.kpis) assert(Array.isArray(hub.body.kpis), 'hub.kpis array');
  console.log('ok portfolio/hub', { tasks: hub.body.tasks?.length, kpis: hub.body.kpis?.length });

  const execBoard = await get('/api/ops-analytics/execution-board?board=geral&period=30', attendantToken);
  assert(execBoard.status === 200, `execution-board: ${execBoard.status}`);
  assert(Array.isArray(execBoard.body.tasks), 'execution-board.tasks array');
  console.log('ok execution-board', execBoard.body.summary);

  const taskCtx = await get('/api/ops-analytics/tasks/launch-context?scope=ag', attendantToken);
  assert(taskCtx.status === 200, `tasks/launch-context: ${taskCtx.status}`);
  assert(Array.isArray(taskCtx.body.drivers), 'task launch drivers array');
  console.log('ok tasks/launch-context', { drivers: taskCtx.body.drivers?.length });

  const financialEmail = process.env.SMOKE_FINANCIAL_EMAIL;
  const financialPassword = process.env.SMOKE_FINANCIAL_PASSWORD;
  if (financialEmail && financialPassword) {
    const finToken = await login(financialEmail, financialPassword);
    const finHub = await get('/api/ops-analytics/financial-hub?period=30', finToken);
    assert(finHub.status === 200, `financial-hub: ${finHub.status}`);
    assert(Array.isArray(finHub.body.tasks), 'financial-hub.tasks array');
    console.log('ok financial-hub', finHub.body.totals);
  } else {
    console.log('skip financial-hub: SMOKE_FINANCIAL_EMAIL/PASSWORD not set');
  }

  if (supervisorEmail && supervisorPassword) {
    const supToken = await login(supervisorEmail, supervisorPassword);
    const coord = await get('/api/ops-analytics/coordination?period=30', supToken);
    assert(coord.status === 200, `coordination: ${coord.status}`);
    assert(Array.isArray(coord.body.leaders), 'coordination.leaders array');
    console.log('ok coordination', coord.body.totals);

    const denied = await get('/api/ops-analytics/portfolio?period=30', supToken);
    assert(denied.status === 403, `supervisor must not access portfolio: ${denied.status}`);
    console.log('ok RBAC supervisor denied portfolio');
  } else {
    console.log('skip coordination: SMOKE_SUPERVISOR_EMAIL/PASSWORD not set');
  }

  console.log('smoke-ops-analytics-api: all checks passed');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

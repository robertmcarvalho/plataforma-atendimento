#!/usr/bin/env node
/**
 * Smoke de segurança (IDOR) — portal do líder em STAGING.
 * Requer dois usuários líder em workspaces/redes distintas OU um líder + UUIDs conhecidos de outro tenant.
 *
 * Variáveis:
 *   API_BASE_URL
 *   LEADER_A_EMAIL / LEADER_A_PASSWORD
 *   LEADER_B_DRIVER_ID (opcional) — driver fora da rede do líder A
 *   LEADER_B_PHARMACY_ID (opcional)
 *   FOREIGN_WORKSPACE_ID (opcional) — header x-workspace-id malicioso na API geral
 */
const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const emailA = process.env.LEADER_A_EMAIL || process.env.API_LEADER_EMAIL || '';
const passwordA = process.env.LEADER_A_PASSWORD || process.env.API_LEADER_PASSWORD || '';
const foreignDriverId = process.env.LEADER_B_DRIVER_ID || '00000000-0000-4000-8000-000000000099';
const foreignPharmacyId = process.env.LEADER_B_PHARMACY_ID || '00000000-0000-4000-8000-000000000098';

if (!emailA || !passwordA) {
  console.log('SKIP — defina LEADER_A_EMAIL e LEADER_A_PASSWORD');
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
  return { status: res.status, ok: res.ok, body };
}

async function login(email, password) {
  const res = await http('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok || !res.body?.token) throw new Error(`login failed ${res.status}`);
  return res.body.token;
}

const token = await login(emailA, passwordA);
const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

const cases = [];

async function expectDenied(name, fn) {
  const res = await fn();
  const denied = [403, 404, 409].includes(res.status);
  cases.push({ name, status: res.status, pass: denied, detail: res.body?.error || res.body });
  if (!denied) {
    console.error(`FAIL ${name}: esperado 403/404, recebeu ${res.status}`, res.body);
  } else {
    console.log(`PASS ${name} → ${res.status}`);
  }
}

await expectDenied('GET driver fora da rede', () =>
  http(`/api/leader-portal/drivers/${foreignDriverId}`, { headers: auth })
);

await expectDenied('PATCH schedule driver fora da rede', () =>
  http(`/api/leader-portal/drivers/${foreignDriverId}/schedule`, {
    method: 'PATCH',
    headers: auth,
    body: JSON.stringify({ work_schedule: { mon: ['08:00-18:00'] } }),
  })
);

await expectDenied('POST absence driver/fora rede', () =>
  http('/api/leader-portal/absences', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      driver_id: foreignDriverId,
      pharmacy_id: foreignPharmacyId,
      date: new Date().toISOString().slice(0, 10),
      reason: 'idor-test',
    }),
  })
);

await expectDenied('POST daily driver/fora rede', () =>
  http('/api/leader-portal/dailies', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      driver_id: foreignDriverId,
      pharmacy_id: foreignPharmacyId,
      amount: 10,
      date: new Date().toISOString().slice(0, 10),
    }),
  })
);

await expectDenied('POST supply-request driver/fora rede', () =>
  http('/api/leader-portal/supply-requests', {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({
      driver_id: foreignDriverId,
      pharmacy_id: foreignPharmacyId,
      item_type: 'uniform',
      quantity: 1,
    }),
  })
);

const me = await http('/api/leader-portal/me', { headers: auth });
if (!me.ok) {
  console.warn(`WARN /me ${me.status} — IDOR cases são o gate principal`);
}

const failed = cases.filter((c) => !c.pass);
console.log(JSON.stringify({ ok: failed.length === 0, cases }, null, 2));
process.exit(failed.length ? 1 : 0);

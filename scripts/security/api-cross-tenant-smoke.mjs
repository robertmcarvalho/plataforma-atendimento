#!/usr/bin/env node
/**
 * Smoke HTTP: tentativas de bypass de workspace (staging).
 *
 *   API_BASE_URL, API_ADMIN_EMAIL, API_ADMIN_PASSWORD
 *   FOREIGN_CONVERSATION_ID (opcional)
 *   FOREIGN_WORKSPACE_ID no header x-workspace-id
 */
import { blockProductionUrl, httpJson, loginAdmin } from '../stress/lib/httpClient.mjs';

const baseUrl = process.env.API_BASE_URL || 'http://localhost:3001';
/** Use atendente (não admin) — platform_admin pode ter escopo amplo legítimo. */
const email =
  process.env.API_ATTENDANT_EMAIL || process.env.API_ADMIN_EMAIL || '';
const password =
  process.env.API_ATTENDANT_PASSWORD || process.env.API_ADMIN_PASSWORD || '';
const foreignConvId = process.env.FOREIGN_CONVERSATION_ID || '00000000-0000-4000-8000-000000000001';
const foreignWs = process.env.FOREIGN_WORKSPACE_ID || '00000000-0000-4000-8000-000000000002';

if (!email || !password) {
  console.log('SKIP — API_ADMIN_EMAIL/PASSWORD');
  process.exit(0);
}
blockProductionUrl(baseUrl, 'CONFIRM_STAGING_SECURITY');

const token = await loginAdmin(baseUrl, email, password);
const cases = [];

async function expectBlocked(name, fn) {
  const res = await fn();
  const pass = [403, 404, 412].includes(res.status);
  cases.push({ name, pass, status: res.status });
  console.log(pass ? `PASS ${name} (${res.status})` : `FAIL ${name} (${res.status})`);
}

await expectBlocked('GET conversa estranha', () =>
  httpJson(baseUrl, `/api/conversations/${foreignConvId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
);

const withForeignHeader = await httpJson(baseUrl, '/api/conversations?page=1&limit=5', {
  headers: {
    Authorization: `Bearer ${token}`,
    'x-workspace-id': foreignWs,
  },
});
// Header forjado deve ser ignorado (412) ou não retornar dados do workspace alheio (200 com escopo da sessão).
const headerPass =
  [403, 404, 412].includes(withForeignHeader.status) ||
  (withForeignHeader.status === 200 &&
    !(withForeignHeader.body?.data || []).some((row) => String(row?.workspace_id || '') === foreignWs));
cases.push({
  name: 'x-workspace-id forjado ignorado',
  pass: headerPass,
  status: withForeignHeader.status,
});
console.log(headerPass ? `PASS x-workspace-id forjado (${withForeignHeader.status})` : `FAIL x-workspace-id forjado (${withForeignHeader.status})`);

const failed = cases.filter((c) => !c.pass);
console.log(JSON.stringify({ ok: failed.length === 0, cases }, null, 2));
process.exit(failed.length ? 1 : 0);

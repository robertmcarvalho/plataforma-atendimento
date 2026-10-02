/**
 * Smoke portal-only — requer API no ar e credenciais admin.
 * SMOKE_API_URL=http://localhost:3001 SMOKE_EMAIL=... SMOKE_PASSWORD=... node scripts/smoke-portal.mjs
 */

const base = (process.env.SMOKE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const email = process.env.SMOKE_EMAIL || '';
const password = process.env.SMOKE_PASSWORD || '';
const workspaceId = process.env.SMOKE_WORKSPACE_ID || '';

if (!email || !password) {
  console.error('Defina SMOKE_EMAIL e SMOKE_PASSWORD');
  process.exit(1);
}

async function req(path, opts = {}) {
  const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  if (opts.token) headers.Authorization = `Bearer ${opts.token}`;
  if (workspaceId) headers['x-workspace-id'] = workspaceId;
  const res = await fetch(`${base}${path}`, { ...opts, headers });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  if (!res.ok) throw new Error(`${opts.method || 'GET'} ${path} → ${res.status}: ${JSON.stringify(body)}`);
  return body;
}

async function main() {
  console.log('Login…');
  const login = await req('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  const token = login.token || login.access_token;
  if (!token) throw new Error('Sem token no login');

  console.log('Catálogos…');
  await req('/api/workspace-catalogs', { token });

  console.log('Simulate intake…');
  await req('/api/workspace-catalogs/simulate-intake', {
    method: 'POST',
    token,
    body: JSON.stringify({ profile_code: 'driver', sector_key: 'operacional', demand_key: 'drv-op-cadastro' }),
  }).catch(() => console.warn('  (simulate skipped — ajuste demand_key no workspace)'));

  console.log('Users counts…');
  await req('/api/users/counts-by-role', { token });

  console.log('Reports summary…');
  await req('/api/reports/summary?period=7', { token });

  console.log('Channel rollup…');
  await req('/api/integrations/channels/rollup-stats', { method: 'POST', token, body: JSON.stringify({}) }).catch((e) =>
    console.warn('  rollup:', e.message)
  );

  console.log('OK — smoke básico passou.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

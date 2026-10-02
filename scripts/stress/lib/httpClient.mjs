export async function httpJson(baseUrl, path, init = {}) {
  const started = performance.now();
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, init);
  const txt = await res.text();
  let body;
  try {
    body = txt ? JSON.parse(txt) : null;
  } catch {
    body = txt;
  }
  return { ok: res.ok, status: res.status, ms: performance.now() - started, body };
}

export async function loginAdmin(baseUrl, email, password) {
  const res = await httpJson(baseUrl, '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok || !res.body?.token) {
    throw new Error(`login failed: ${res.status}`);
  }
  return res.body.token;
}

const PROD_SUPABASE_REF = 'omhlbavfsttwcnybzvcd';

export function blockProductionUrl(url, flagName = 'CONFIRM_PRODUCTION_STRESS') {
  const raw = String(url || '');
  if (/production|aetheraai\.online/i.test(raw) && process.env[flagName] !== 'true') {
    console.error(`Bloqueado: URL parece produção. Use staging ou ${flagName}=true`);
    process.exit(1);
  }
  if (process.env.SUPABASE_URL?.includes(PROD_SUPABASE_REF) && process.env[flagName] !== 'true') {
    console.error(`Bloqueado: SUPABASE_URL aponta para produção (${PROD_SUPABASE_REF}).`);
    process.exit(1);
  }
}

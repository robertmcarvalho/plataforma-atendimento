import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return new Map();
  const values = new Map();
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    values.set(key, value);
  }
  return values;
}

function resolveSupabaseSettings() {
  const envPath = path.join(process.cwd(), 'apps', 'api-service', '.env');
  const envValues = parseEnvFile(envPath);
  const url = process.env.SUPABASE_URL || envValues.get('SUPABASE_URL');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envValues.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url) throw new Error('SUPABASE_URL ausente (apps/api-service/.env ou env var)');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente (apps/api-service/.env ou env var)');
  return { url, serviceKey };
}

function generatePassword() {
  // 18 chars, includes upper/lower/digit/symbol to satisfy common policies.
  const raw = crypto.randomBytes(16).toString('base64url');
  return `Dev@${raw.slice(0, 14)}!`;
}

function assertDevOnlyScript() {
  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEV_SCRIPTS !== 'true') {
    throw new Error('Script dev-only bloqueado em producao. Defina ALLOW_DEV_SCRIPTS=true apenas em ambiente controlado.');
  }
}

async function main() {
  assertDevOnlyScript();
  const { url, serviceKey } = resolveSupabaseSettings();

  const email = process.env.DEV_ADMIN_EMAIL || 'dev-admin@fluxfarma.local';
  const name = process.env.DEV_ADMIN_NAME || 'Administrador Desenvolvimento';
  const phone = process.env.DEV_ADMIN_PHONE || '+5534999990000';
  const password = process.env.DEV_ADMIN_PASSWORD || generatePassword();

  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // 1) Find or create Supabase Auth user
  let authUser = null;

  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw listErr;
  const existing = (listed?.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    authUser = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    authUser = data.user;
  }

  if (!authUser?.id) throw new Error('Falha ao obter auth user id');

  // 2) Ensure role_id (admin) and sector_id (Atendimento Geral) for public.users
  const { data: roleRow, error: roleErr } = await supabase.from('roles').select('id').eq('name', 'admin').maybeSingle();
  if (roleErr) throw roleErr;
  if (!roleRow?.id) throw new Error("Role 'admin' nao encontrada em public.roles");

  const { data: sectorRow, error: sectorErr } = await supabase
    .from('sectors')
    .select('id')
    .eq('name', 'Atendimento Geral')
    .maybeSingle();
  if (sectorErr) throw sectorErr;

  const { error: upsertErr } = await supabase.from('users').upsert(
    {
      id: authUser.id,
      name,
      email,
      phone,
      role_id: roleRow.id,
      sector_id: sectorRow?.id ?? null,
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (upsertErr) throw upsertErr;

  console.log(`DEV_ADMIN_EMAIL=${email}`);
  console.log(`DEV_ADMIN_PASSWORD=${password}`);
}

main().catch((err) => {
  const msg = err?.message || String(err);
  console.error(msg);
  const code = err?.code || err?.cause?.code;
  if (code === 'EACCES' || String(msg).includes('fetch failed')) {
    console.error('');
    console.error('Dica: se o HTTPS para o Supabase estiver bloqueado (firewall/antivirus), use o fallback via Postgres:');
    console.error('  npm run create:dev-admin:sql');
  }
  process.exit(1);
});

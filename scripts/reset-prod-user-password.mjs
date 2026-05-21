#!/usr/bin/env node
/**
 * Redefine senha de um usuário em produção (Auth + must_change_password).
 * Uso:
 *   node scripts/reset-prod-user-password.mjs --email luizcisco1113@gmail.com
 *   CONFIRM_PROD_USER_PASSWORD_RESET=true node scripts/reset-prod-user-password.mjs --email ...
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { loadProductionApiEnv, assertProductionTarget } from './lib/loadProdEnv.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs() {
  const emailIdx = process.argv.indexOf('--email');
  const email = emailIdx >= 0 ? process.argv[emailIdx + 1]?.trim() : '';
  if (!email) throw new Error('Use --email usuario@exemplo.com');
  return { email };
}

function generateTemporaryPassword(length = 16) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let out = '';
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  for (let i = 0; i < length; i++) out += chars[bytes[i] % chars.length];
  return out;
}

async function main() {
  if (process.env.CONFIRM_PROD_USER_PASSWORD_RESET !== 'true') {
    throw new Error('Defina CONFIRM_PROD_USER_PASSWORD_RESET=true');
  }
  const { email } = parseArgs();
  loadProductionApiEnv();
  const url = process.env.SUPABASE_URL || '';
  process.env.CONFIRM_PRODUCTION_TARGET = 'true';
  assertProductionTarget(url);

  const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const { data: user, error } = await sb.from('users').select('id, name, email').eq('email', email).maybeSingle();
  if (error || !user?.id) throw new Error(`Usuário não encontrado: ${email}`);

  const temp = generateTemporaryPassword();
  const { error: authErr } = await sb.auth.admin.updateUserById(user.id, { password: temp });
  if (authErr) throw authErr;

  await sb
    .from('users')
    .update({ must_change_password: true, updated_at: new Date().toISOString() })
    .eq('id', user.id);

  const reportsDir = join(__dirname, '..', 'reports');
  mkdirSync(reportsDir, { recursive: true });
  const outPath = join(reportsDir, 'luiz-password-reset.txt');
  writeFileSync(
    outPath,
    `name=${user.name}\nemail=${user.email}\npassword=${temp}\nreset_at=${new Date().toISOString()}\n`,
    'utf8'
  );

  console.log(JSON.stringify({ ok: true, user_id: user.id, email: user.email, report: outPath }, null, 2));
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});

#!/usr/bin/env node
/**
 * Diagnóstico de convite/e-mail em produção.
 * Uso: node scripts/diagnose-prod-invite-email.mjs --email natobruno29@gmail.com
 */
import { createClient } from '@supabase/supabase-js';
import { loadProductionApiEnv, assertProductionTarget, projectRefFromSupabaseUrl } from './lib/loadProdEnv.mjs';

const email = (() => {
  const i = process.argv.indexOf('--email');
  return (i >= 0 ? process.argv[i + 1] : process.argv[2] || '').trim().toLowerCase();
})();

if (!email) {
  console.error('Uso: node scripts/diagnose-prod-invite-email.mjs --email usuario@exemplo.com');
  process.exit(1);
}

loadProductionApiEnv();
const url = process.env.SUPABASE_URL || '';
assertProductionTarget(url);

const sb = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const report = {
  at: new Date().toISOString(),
  ref: projectRefFromSupabaseUrl(url),
  email,
};

const { data: user, error: userErr } = await sb
  .from('users')
  .select('id, name, email, username, is_active, must_change_password, provisioned_at, created_at, updated_at')
  .ilike('email', email)
  .maybeSingle();

report.user = userErr ? { error: userErr.message } : user;

if (user?.id) {
  const { data: memberships } = await sb
    .from('workspace_memberships')
    .select('workspace_id, is_active, is_default, workspaces(display_name, slug)')
    .eq('user_id', user.id);
  report.memberships = memberships;

  const { data: authUser } = await sb.auth.admin.getUserById(user.id);
  report.auth = authUser?.user
    ? {
        email: authUser.user.email,
        email_confirmed_at: authUser.user.email_confirmed_at,
        created_at: authUser.user.created_at,
        last_sign_in_at: authUser.user.last_sign_in_at,
      }
    : null;
}

const { data: deliveries, error: delErr } = await sb
  .from('email_delivery_log')
  .select('id, template_key, recipient, status, error_message, metadata, created_at, workspace_id')
  .ilike('recipient', email)
  .order('created_at', { ascending: false })
  .limit(20);

report.email_delivery_log = delErr ? { error: delErr.message } : deliveries;

const { data: audits } = await sb
  .from('audit_logs')
  .select('action, created_at, metadata, actor_id')
  .eq('entity_type', 'user')
  .or(user?.id ? `entity_id.eq.${user.id},metadata->>email.ilike.${email}` : `metadata->>email.ilike.${email}`)
  .order('created_at', { ascending: false })
  .limit(15);

report.audit_logs_user = audits;

// Fallback: audit by entity_id only
if (user?.id && (!audits?.length)) {
  const { data: audits2 } = await sb
    .from('audit_logs')
    .select('action, created_at, metadata, actor_id')
    .eq('entity_type', 'user')
    .eq('entity_id', user.id)
    .order('created_at', { ascending: false })
    .limit(15);
  report.audit_logs_entity = audits2;
}

console.log(JSON.stringify(report, null, 2));

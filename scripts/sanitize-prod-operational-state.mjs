#!/usr/bin/env node
/**
 * Produção (omhlb): mantém 6 usuários reais, 3 canais Flux Farma, remove QA/teste e histórico de conversas.
 *
 *   node scripts/sanitize-prod-operational-state.mjs
 *   $env:CONFIRM_PROD_SANITIZE="true"
 *   node scripts/sanitize-prod-operational-state.mjs --execute
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
import { assertProductionTarget, loadProductionApiEnv, resolveProductionDbUrl } from './lib/loadProdEnv.mjs';
import { PROD_REF } from './lib/migrateLegacyDb.mjs';

const KEEP_EMAILS = [
  'alberto_kennedy@hotmail.com',
  'luizcisco1113@gmail.com',
  'natobruno29@gmail.com',
  'robert@fluxfarma.com.br',
  'saragabriellesgss@gmail.com',
  'taniajoaquim029@gmail.com',
].map((e) => e.toLowerCase());

const KEEP_USER_NAMES = {
  'robert@fluxfarma.com.br': 'Robert Platform',
};

const KEEP_CHANNEL_IDS = new Set([
  '18926721-0c3f-4722-b09b-e423365d81fc', // email smtp
  '641822a1-a183-4693-b337-7a2c66b2204e', // llm
  '070baf09-69c9-4962-a61f-3f7507895587', // whatsapp Flux Farma
]);

const execute = process.argv.includes('--execute');
if (execute && process.env.CONFIRM_PROD_SANITIZE !== 'true') {
  throw new Error('Defina CONFIRM_PROD_SANITIZE=true para executar.');
}

loadProductionApiEnv();
process.env.CONFIRM_PRODUCTION_TARGET = 'true';
const dbUrl = resolveProductionDbUrl();
assertProductionTarget(dbUrl);

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

const plan = { execute, ref: PROD_REF };

const users = (await client.query(`SELECT id, email, name, platform_role FROM public.users ORDER BY email`)).rows;
plan.users_before = users.length;
plan.users_remove = users.filter((u) => !KEEP_EMAILS.includes((u.email || '').toLowerCase())).map((u) => u.email);
plan.users_keep = users.filter((u) => KEEP_EMAILS.includes((u.email || '').toLowerCase())).map((u) => u.email);

const channels = (await client.query(
  `SELECT id, channel_type, provider, is_default, external_id FROM workspace_channels ORDER BY channel_type`
)).rows;
plan.channels_before = channels.length;
plan.channels_remove = channels.filter((c) => !KEEP_CHANNEL_IDS.has(c.id)).map((c) => ({
  id: c.id,
  channel_type: c.channel_type,
  external_id: c.external_id,
}));

const convCount = (await client.query(`SELECT COUNT(*)::int c FROM conversations`)).rows[0].c;
const contactCount = (await client.query(`SELECT COUNT(*)::int c FROM contacts`)).rows[0].c;
plan.conversations_delete_all = convCount;
plan.contacts_before = contactCount;

const smokeLeaders = (
  await client.query(
    `SELECT COUNT(*)::int c FROM leaders WHERE name ILIKE 'smoke%' OR email ILIKE '%@fluxfarma.local%' OR phone = '5591999900001'`
  )
).rows[0].c;
plan.leaders_smoke_remove = smokeLeaders;

if (!execute) {
  console.log(JSON.stringify({ ok: true, dryRun: true, plan }, null, 2));
  console.log('\nExecute: CONFIRM_PROD_SANITIZE=true node scripts/sanitize-prod-operational-state.mjs --execute');
  await client.end();
  process.exit(0);
}

await client.query('BEGIN');
try {
  // 1. Histórico de conversas (todas)
  await client.query(`DELETE FROM public.ticket_events WHERE ticket_id IN (SELECT id FROM tickets WHERE conversation_id IS NOT NULL)`);
  await client.query(`DELETE FROM public.tickets WHERE conversation_id IS NOT NULL`);
  await client.query(`DELETE FROM public.pending_tasks WHERE conversation_id IS NOT NULL`);
  await client.query(`DELETE FROM public.conversation_assignments WHERE conversation_id IS NOT NULL`);
  await client.query(`DELETE FROM public.internal_notes WHERE conversation_id IS NOT NULL`);
  await client.query(`DELETE FROM public.internal_chat_messages WHERE conversation_id IS NOT NULL`);
  await client.query(`DELETE FROM public.messages WHERE conversation_id IS NOT NULL`);
  await client.query(`DELETE FROM public.processed_webhook_events`);
  const delConv = await client.query(`DELETE FROM public.conversations RETURNING id`);
  plan.conversations_deleted = delConv.rowCount;

  // 2. Contatos (todos — eram só vínculo de teste/histórico)
  const delContacts = await client.query(`DELETE FROM public.contacts RETURNING id`);
  plan.contacts_deleted = delContacts.rowCount;

  // 3. Canais duplicados / fora da lista Flux Farma
  const delCh = await client.query(
    `DELETE FROM workspace_channels WHERE id <> ALL($1::uuid[]) RETURNING id, channel_type`,
    [[...KEEP_CHANNEL_IDS]]
  );
  plan.channels_deleted = delCh.rowCount;

  // 4. Garantir WhatsApp único default
  await client.query(
    `UPDATE workspace_channels SET is_default = false WHERE channel_type = 'whatsapp' AND id <> '070baf09-69c9-4962-a61f-3f7507895587'`
  );
  await client.query(
    `UPDATE workspace_channels SET is_default = true, status = 'active', external_id = '692486823954602'
     WHERE id = '070baf09-69c9-4962-a61f-3f7507895587'`
  );

  // 5. Líderes / cadastros smoke
  await client.query(`DELETE FROM leader_pharmacy_links WHERE leader_id IN (
    SELECT id FROM leaders WHERE name ILIKE 'smoke%' OR email ILIKE '%@fluxfarma.local%' OR phone = '5591999900001'
  )`);
  await client.query(`DELETE FROM leaders WHERE name ILIKE 'smoke%' OR email ILIKE '%@fluxfarma.local%' OR phone = '5591999900001'`);

  // 6. Tickets / eventos ligados a usuários de teste
  await client.query(`DELETE FROM public.ticket_events`);
  await client.query(`DELETE FROM public.tickets`);

  // 7. Remover usuários fora da lista
  const removeUsers = users.filter((u) => !KEEP_EMAILS.includes((u.email || '').toLowerCase()));
  for (const u of removeUsers) {
    await client.query(`DELETE FROM workspace_memberships WHERE user_id = $1`, [u.id]);
    try {
      await client.query(`DELETE FROM user_sectors WHERE user_id = $1`, [u.id]);
    } catch {
      /* */
    }
    await client.query(`DELETE FROM pharmacy_sector_attendants WHERE attendant_id = $1`, [u.id]);
    await client.query(`UPDATE pharmacies SET primary_attendant_id = NULL WHERE primary_attendant_id = $1`, [u.id]);
    await client.query(`UPDATE pharmacies SET secondary_attendant_id = NULL WHERE secondary_attendant_id = $1`, [u.id]);
    await client.query(`DELETE FROM public.users WHERE id = $1`, [u.id]);
    await client.query(`DELETE FROM auth.identities WHERE user_id = $1`, [u.id]);
    await client.query(`DELETE FROM auth.users WHERE id = $1`, [u.id]);
  }
  plan.users_deleted = removeUsers.length;

  // 8. Ajustar usuários mantidos
  for (const email of KEEP_EMAILS) {
    const name = KEEP_USER_NAMES[email];
    const platformRole = email === 'robert@fluxfarma.com.br' ? 'platform_owner' : 'member';
    await client.query(
      `UPDATE public.users SET platform_role = $2, is_active = true, must_change_password = false,
        name = COALESCE($3, name), updated_at = now()
       WHERE lower(email) = lower($1)`,
      [email, platformRole, name || null]
    );
  }

  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
}

// Auth API cleanup for emails not in keep list (orphans)
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
try {
  const { data: authList } = await sb.auth.admin.listUsers({ page: 1, perPage: 500 });
  for (const u of authList?.users || []) {
    if (!KEEP_EMAILS.includes((u.email || '').toLowerCase())) {
      await sb.auth.admin.deleteUser(u.id);
      plan.auth_api_deleted = (plan.auth_api_deleted || 0) + 1;
    }
  }
} catch (e) {
  plan.auth_api_cleanup_error = e.message;
}

const after = {
  users: (await client.query(`SELECT email, name, platform_role FROM users ORDER BY email`)).rows,
  channels: (await client.query(
    `SELECT id, channel_type, provider, is_default, external_id FROM workspace_channels ORDER BY channel_type`
  )).rows,
  conversations: (await client.query(`SELECT COUNT(*)::int c FROM conversations`)).rows[0].c,
  contacts: (await client.query(`SELECT COUNT(*)::int c FROM contacts`)).rows[0].c,
};

plan.after = after;
await client.end();

mkdirSync(join(process.cwd(), 'reports'), { recursive: true });
writeFileSync(join(process.cwd(), 'reports', `sanitize-prod-${Date.now()}.json`), JSON.stringify(plan, null, 2), 'utf8');
console.log(JSON.stringify({ ok: true, plan }, null, 2));

#!/usr/bin/env node
/**
 * Limpeza de dados de TESTE / SEED no Postgres (Supabase).
 *
 * MAPEAMENTO (critérios do repo + scripts dev):
 *
 * | Origem / entidade        | Critério no banco |
 * |---------------------------|-------------------|
 * | Conversas de teste        | tags: seed-dev, validation-test, local-test, manual-test, queue-test |
 * | Mensagens / idempotência  | meta_message_id: seed-inbound-dev, seed-outbound-dev, val-in-*, val-out-* |
 * | Webhook idempotência      | processed_webhook_events.meta_message_id (mesmos ids) |
 * | Templates Meta            | meta_template_name = seed_dev_template |
 * | Campanhas seed            | name LIKE 'Campanha Seed%' |
 * | Automações seed           | name LIKE 'Automacao Seed%' |
 * | Entradas financeiras      | driver_id em drivers seed (telefone/tag) |
 * | Motoristas                | phone = 5534999991003 OU tags contém seed-dev |
 * | Farmácias                 | cnpj = 12345678000195 |
 * | Líderes                   | phone IN (5534999991001, 5534999991002) |
 * | Contactos                 | wa_phone em lista seed (incl. 5534999990000 dev-admin) |
 * | Utilizadores teste        | emails @fluxfarma.local, @rhcoopmob.dev, dev-admin@ (opcional) |
 *
 * NÃO remove: roles, sectors, app_settings de migrações (dados operacionais base).
 *
 * Ordem dos DELETE (FKs):
 *  1. Conversas com tags de teste (cascade mensagens, notas, assignments, …)
 *  2. Mensagens meta seed (órfãs)
 *  3. processed_webhook_events (ids seed)
 *  4. automation_rules nome Automacao Seed%
 *  5. campaigns nome Campanha Seed%
 *  6. message_templates meta seed_dev_template
 *  7. financial_entries (drivers seed)
 *  8. drivers seed
 *  9. pharmacies CNPJ seed
 * 10. leaders telefones seed
 * 11. contacts wa_phone seed
 * 12. Opcional: public.users + auth.users (emails de teste)
 *
 * Uso:
 *   npm run cleanup:prod-test-data
 *   node scripts/cleanup-prod-test-data.mjs --execute
 *   node scripts/cleanup-prod-test-data.mjs --execute --delete-test-users
 */
import { Client } from 'pg';
import { assertProductionTarget, loadProductionApiEnv, resolveProductionDbUrl } from './lib/loadProdEnv.mjs';

const META_SEED_IDS = [
  'seed-inbound-dev',
  'seed-outbound-dev',
  'val-in-1',
  'val-out-1',
  'val-in-2',
  'val-in-3',
];

/** E.164 sem + (contact.wa_phone, drivers.phone, leaders.phone) */
const CONTACT_SEED_PHONES = [
  '5534999991003',
  '5534900000001',
  '5534900000002',
  '5534999990000', // create-dev-admin default
];

const LEADER_SEED_PHONES = ['5534999991001', '5534999991002'];

const TEST_USER_EMAIL_SQL = `email ILIKE '%@fluxfarma.local%' OR email ILIKE '%@rhcoopmob.dev%' OR email ILIKE 'dev-admin@%'`;

const CONVERSATION_TAG_SQL = `'seed-dev' = ANY(c.tags) OR 'validation-test' = ANY(c.tags) OR 'local-test' = ANY(c.tags)
        OR 'manual-test' = ANY(c.tags) OR 'queue-test' = ANY(c.tags) OR 'smoke-staging' = ANY(c.tags)`;

/** Conversas de teste por tag, resumo ou contato sintético de staging. */
const CONVERSATION_TEST_WHERE = `(
  ${CONVERSATION_TAG_SQL}
  OR c.summary ILIKE '%teste sintetico%'
  OR c.summary ILIKE '%teste sintético%'
  OR c.summary ILIKE '%smoke staging%'
  OR c.summary ILIKE 'Smoke staging%'
  OR EXISTS (
    SELECT 1 FROM public.contacts ct
    WHERE ct.id = c.contact_id
      AND (
        ct.wa_phone LIKE '559999000123%'
        OR ct.display_name ILIKE 'smoke%'
        OR ct.display_name ILIKE '%staging contact%'
        OR ct.display_name = 'uberlândia'
      )
  )
)`;

const SMOKE_STAGING_PHONE = '5591999900001';

const CADASTRO_SMOKE_SQL = {
  drivers: `(phone = '${SMOKE_STAGING_PHONE}' OR phone = '5534999991003' OR (tags IS NOT NULL AND tags @> ARRAY['smoke-staging']::text[]) OR name ILIKE 'smoke%')`,
  leaders: `(phone = '${SMOKE_STAGING_PHONE}' OR name ILIKE 'smoke%' OR email ILIKE '%@fluxfarma.local%')`,
  pharmacies: `(trade_name ILIKE '%teste%' AND trade_name ILIKE '%farmacia%' OR trade_name ILIKE 'smoke%' OR cnpj = '12345678000195' OR (tags IS NOT NULL AND tags @> ARRAY['smoke-staging']::text[]))`,
};

function resolveConnectionString() {
  delete process.env.SUPABASE_DB_URL;
  loadProductionApiEnv();
  const url = resolveProductionDbUrl();
  assertProductionTarget(url);
  return url;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    execute: argv.includes('--execute'),
    deleteTestUsers: argv.includes('--delete-test-users'),
    confirm: process.env.CONFIRM_PROD_TEST_DATA_CLEANUP === 'true',
  };
}

async function main() {
  const { execute, deleteTestUsers, confirm } = parseArgs();
  if (execute && !confirm) {
    throw new Error('Confirmação ausente. Defina CONFIRM_PROD_TEST_DATA_CLEANUP=true para executar deletes.');
  }
  process.env.CONFIRM_PRODUCTION_TARGET = process.env.CONFIRM_PRODUCTION_TARGET || 'true';
  const connectionString = resolveConnectionString();
  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const q1 = async (sql, params = []) => (await client.query(sql, params)).rows[0].c;

  const summary = {};

  if (!execute) {
    summary.conversations_tagged = await q1(`SELECT COUNT(*)::int AS c FROM public.conversations c WHERE ${CONVERSATION_TAG_SQL}`);
    summary.conversations_test = await q1(
      `SELECT COUNT(*)::int AS c FROM public.conversations c WHERE ${CONVERSATION_TEST_WHERE}`
    );
    summary.messages_seed_meta = await q1(
      `SELECT COUNT(*)::int AS c FROM public.messages WHERE meta_message_id = ANY($1::text[])`,
      [META_SEED_IDS]
    );
    summary.processed_webhook_seed = await q1(
      `SELECT COUNT(*)::int AS c FROM public.processed_webhook_events WHERE meta_message_id = ANY($1::text[])`,
      [META_SEED_IDS]
    );
    summary.templates_seed = await q1(
      `SELECT COUNT(*)::int AS c FROM public.message_templates WHERE meta_template_name = 'seed_dev_template'`
    );
    summary.campaigns_seed = await q1(`SELECT COUNT(*)::int AS c FROM public.campaigns WHERE name LIKE 'Campanha Seed%'`);
    summary.automation_seed = await q1(
      `SELECT COUNT(*)::int AS c FROM public.automation_rules WHERE name LIKE 'Automacao Seed%'`
    );
    summary.drivers_seed = await q1(
      `SELECT COUNT(*)::int AS c FROM public.drivers WHERE phone = '5534999991003' OR (tags IS NOT NULL AND tags @> ARRAY['seed-dev']::text[])`
    );
    summary.pharmacies_seed = await q1(`SELECT COUNT(*)::int AS c FROM public.pharmacies WHERE cnpj = '12345678000195'`);
    summary.leaders_seed = await q1(
      `SELECT COUNT(*)::int AS c FROM public.leaders WHERE phone = ANY($1::text[])`,
      [LEADER_SEED_PHONES]
    );
    summary.contacts_seed = await q1(
      `SELECT COUNT(*)::int AS c FROM public.contacts WHERE wa_phone = ANY($1::text[])`,
      [CONTACT_SEED_PHONES]
    );
    summary.drivers_smoke_staging = await q1(
      `SELECT COUNT(*)::int AS c FROM public.drivers WHERE ${CADASTRO_SMOKE_SQL.drivers}`
    );
    summary.leaders_smoke_staging = await q1(
      `SELECT COUNT(*)::int AS c FROM public.leaders WHERE ${CADASTRO_SMOKE_SQL.leaders}`
    );
    summary.pharmacies_smoke_staging = await q1(
      `SELECT COUNT(*)::int AS c FROM public.pharmacies WHERE ${CADASTRO_SMOKE_SQL.pharmacies}`
    );

    if (deleteTestUsers) {
      summary.users_test_pattern = await q1(
        `SELECT COUNT(*)::int AS c FROM public.users WHERE ${TEST_USER_EMAIL_SQL}`
      );
    }

    await client.end();
    console.log(
      JSON.stringify(
        {
          ok: true,
          dryRun: true,
          hint: 'Reexecute com --execute para aplicar deletes (apos backup).',
          summary,
        },
        null,
        2
      )
    );
    return;
  }

  await client.query('begin');

  const del = async (label, sql, params = []) => {
    const r = await client.query(sql, params);
    const n = r.rowCount ?? 0;
    summary[label] = n;
    return n;
  };

  try {
    await del(
      `tickets_test_conversations`,
      `DELETE FROM public.tickets WHERE conversation_id IN (
        SELECT id FROM public.conversations c WHERE ${CONVERSATION_TEST_WHERE}
      )`
    );

    await del(
      `pending_tasks_test_conversations`,
      `DELETE FROM public.pending_tasks WHERE conversation_id IN (
        SELECT id FROM public.conversations c WHERE ${CONVERSATION_TEST_WHERE}
      )`
    );

    await del(`conversations_test`, `DELETE FROM public.conversations c WHERE ${CONVERSATION_TEST_WHERE}`);

    await del(
      `contacts_orphan_smoke`,
      `DELETE FROM public.contacts
       WHERE wa_phone LIKE '559999000123%'
          OR display_name ILIKE 'smoke%'
          OR display_name ILIKE '%staging contact%'`
    );

    await del(`messages_meta`, `DELETE FROM public.messages WHERE meta_message_id = ANY($1::text[])`, [META_SEED_IDS]);

    await del(
      `processed_webhook_events`,
      `DELETE FROM public.processed_webhook_events WHERE meta_message_id = ANY($1::text[])`,
      [META_SEED_IDS]
    );

    await del(`automation_rules`, `DELETE FROM public.automation_rules WHERE name LIKE 'Automacao Seed%'`);

    await del(`campaigns`, `DELETE FROM public.campaigns WHERE name LIKE 'Campanha Seed%'`);

    await del(`templates`, `DELETE FROM public.message_templates WHERE meta_template_name = 'seed_dev_template'`);

    await del(
      'financial_entries_seed_drivers',
      `DELETE FROM public.financial_entries fe WHERE fe.driver_id IN (
        SELECT id FROM public.drivers WHERE phone = '5534999991003' OR (tags IS NOT NULL AND tags @> ARRAY['seed-dev']::text[])
      )`
    );

    await del(
      `tickets_smoke_drivers`,
      `DELETE FROM public.tickets WHERE driver_id IN (SELECT id FROM public.drivers WHERE ${CADASTRO_SMOKE_SQL.drivers})`
    );

    await del(
      `drivers_smoke_staging`,
      `DELETE FROM public.drivers WHERE ${CADASTRO_SMOKE_SQL.drivers}`
    );

    await del(
      `drivers`,
      `DELETE FROM public.drivers WHERE phone = '5534999991003' OR (tags IS NOT NULL AND tags @> ARRAY['seed-dev']::text[])`
    );

    await del(`pharmacies_smoke_staging`, `DELETE FROM public.pharmacies WHERE ${CADASTRO_SMOKE_SQL.pharmacies}`);

    await del(`pharmacies`, `DELETE FROM public.pharmacies WHERE cnpj = '12345678000195'`);

    await del(`leaders_smoke_staging`, `DELETE FROM public.leaders WHERE ${CADASTRO_SMOKE_SQL.leaders}`);

    await del(`leaders`, `DELETE FROM public.leaders WHERE phone = ANY($1::text[])`, [LEADER_SEED_PHONES]);

    await del(`contacts`, `DELETE FROM public.contacts WHERE wa_phone = ANY($1::text[])`, [CONTACT_SEED_PHONES]);

    if (deleteTestUsers) {
      await del(
        'ticket_events_test_users',
        `DELETE FROM public.ticket_events WHERE created_by IN (SELECT id FROM public.users WHERE ${TEST_USER_EMAIL_SQL})`
      );
      await del(
        'tickets_assignee_test_users',
        `UPDATE public.tickets SET assignee_user_id = NULL WHERE assignee_user_id IN (SELECT id FROM public.users WHERE ${TEST_USER_EMAIL_SQL})`
      );
      await del(
        'users_public_test_emails',
        `DELETE FROM public.users WHERE ${TEST_USER_EMAIL_SQL}`
      );
      await del(
        'auth_users_test_emails',
        `DELETE FROM auth.users WHERE ${TEST_USER_EMAIL_SQL}`
      );
    }

    await client.query('commit');
    console.log(JSON.stringify({ ok: true, dryRun: false, summary }, null, 2));
  } catch (e) {
    await client.query('rollback');
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err?.stack || err?.message || err);
  process.exit(1);
});

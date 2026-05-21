#!/usr/bin/env node
/** Remove conversas de QA restantes em produção (pós-migração de cadastros). */
import pg from 'pg';
import { resolveProductionDbUrl } from './lib/loadProdEnv.mjs';

if (process.env.CONFIRM_PROD_TEST_DATA_CLEANUP !== 'true') {
  throw new Error('Defina CONFIRM_PROD_TEST_DATA_CLEANUP=true');
}

const CONVERSATION_TEST_WHERE = `(
  summary ILIKE '%teste sintetico%'
  OR summary ILIKE '%teste sintético%'
  OR summary ILIKE '%smoke%'
  OR summary ILIKE '%staging%'
  OR 'smoke-staging' = ANY(tags)
  OR 'seed-dev' = ANY(tags)
  OR 'validation-test' = ANY(tags)
  OR 'local-test' = ANY(tags)
  OR 'manual-test' = ANY(tags)
  OR 'queue-test' = ANY(tags)
  OR contact_id IN (
    SELECT id FROM public.contacts
    WHERE wa_phone LIKE '559999000123%'
      OR display_name ILIKE 'smoke%'
      OR display_name = 'uberlândia'
  )
)`;

const client = new pg.Client({
  connectionString: resolveProductionDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();
await client.query('BEGIN');
const tickets = await client.query(
  `DELETE FROM public.tickets WHERE conversation_id IN (SELECT id FROM public.conversations WHERE ${CONVERSATION_TEST_WHERE})`
);
const pending = await client.query(
  `DELETE FROM public.pending_tasks WHERE conversation_id IN (SELECT id FROM public.conversations WHERE ${CONVERSATION_TEST_WHERE})`
);
const conv = await client.query(`DELETE FROM public.conversations WHERE ${CONVERSATION_TEST_WHERE} RETURNING id`);
await client.query('COMMIT');
const left = await client.query('SELECT COUNT(*)::int c FROM public.conversations');
await client.end();
console.log(
  JSON.stringify(
    {
      ok: true,
      deleted_conversations: conv.rowCount,
      deleted_tickets: tickets.rowCount,
      deleted_pending_tasks: pending.rowCount,
      conversations_remaining: left.rows[0].c,
    },
    null,
    2
  )
);

/**
 * Seed mínimo e idempotente para smokes HTTP em staging.
 *
 * Uso:
 *   $env:SUPABASE_DB_URL=(Get-Content .secrets/staging-supabase-db-url.txt -Raw).Trim()
 *   npm run staging:seed:smoke
 */
import pg from 'pg';
import { readDbUrl } from './lib/readDbUrl.mjs';

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();

try {
  const wsRes = await client.query("select id from public.workspaces where slug = 'default' order by created_at limit 1");
  const workspaceId = wsRes.rows[0]?.id;
  if (!workspaceId) throw new Error('Workspace default não encontrado.');

  await client.query('begin');

  const phone = '5591999900001';
  const existingDriver = await client.query(
    `select id from public.drivers where workspace_id = $1 and phone = $2 order by created_at limit 1`,
    [workspaceId, phone]
  );
  const driver = existingDriver.rows[0]?.id
    ? await client.query(
        `update public.drivers
            set name = 'Smoke Staging Driver', status = 'active', updated_at = now()
          where id = $1
          returning id`,
        [existingDriver.rows[0].id]
      )
    : await client.query(
        `insert into public.drivers (workspace_id, name, phone, city, state, status, driver_type, doc_status, tags)
         values ($1, 'Smoke Staging Driver', $2, 'Smoke City', 'SP', 'active', 'fixed', 'ok', array['smoke-staging'])
         returning id`,
        [workspaceId, phone]
      );

  const existingContact = await client.query(
    `select id from public.contacts where workspace_id = $1 and wa_phone = $2 order by created_at limit 1`,
    [workspaceId, phone]
  );
  const contact = existingContact.rows[0]?.id
    ? await client.query(
        `update public.contacts
            set display_name = 'Smoke Staging Contact',
                profile_type = 'driver',
                driver_id = $2,
                updated_at = now()
          where id = $1
          returning id`,
        [existingContact.rows[0].id, driver.rows[0].id]
      )
    : await client.query(
        `insert into public.contacts (workspace_id, wa_phone, display_name, profile_type, driver_id)
         values ($1, $2, 'Smoke Staging Contact', 'driver', $3)
         returning id`,
        [workspaceId, phone, driver.rows[0].id]
      );

  const conv = await client.query(
    `insert into public.conversations (
       workspace_id, contact_id, status, priority, summary, context_driver_id, tags, opened_at, last_message_at
     )
     values (
       $1, $2, 'open', 'normal', 'Smoke staging conversation', $3, array['smoke-staging'], now(), now()
     )
     returning id`,
    [workspaceId, contact.rows[0].id, driver.rows[0].id]
  );

  await client.query(
    `insert into public.messages (workspace_id, conversation_id, direction, type, content, status, sent_at)
     values ($1, $2, 'inbound', 'text', 'Smoke staging inbound message', 'delivered', now())`,
    [workspaceId, conv.rows[0].id]
  );

  const ticketCode = `SMOKE-STG-${String(Date.now()).slice(-8)}`;
  await client.query(
    `insert into public.tickets (
       workspace_id, ticket_code, conversation_id, driver_id, persona, type, priority,
       sla_minutes, channel_origin, status, due_at, context_snap, classifier_version
     )
     values (
       $1, $2, $3, $4, 'driver', 'payment', 'high',
       120, 'whatsapp', 'open', now() + interval '2 hours', '{"smoke":true}'::jsonb, 'smoke-staging'
     )`,
    [workspaceId, ticketCode, conv.rows[0].id, driver.rows[0].id]
  );

  await client.query('commit');
  console.log(JSON.stringify({ ok: true, workspace_id: workspaceId, driver_id: driver.rows[0].id, conversation_id: conv.rows[0].id }, null, 2));
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error(e?.message || e);
  process.exit(1);
} finally {
  await client.end();
}

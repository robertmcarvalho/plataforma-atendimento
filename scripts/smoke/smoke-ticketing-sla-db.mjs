/**
 * Smoke DB: valida schema de tickets/ticket_events e fluxo minimo de insert/update/delete.
 * Uso: npm run smoke:ticketing-sla-db
 */
import pg from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const REQUIRED_TICKETS = [
  'ticket_code',
  'persona',
  'type',
  'priority',
  'sla_minutes',
  'channel_origin',
  'status',
  'due_at',
  'context_snap',
  'classifier_version',
];

const REQUIRED_TICKET_EVENTS = ['ticket_id', 'event_type', 'payload', 'created_at'];

function missingCols(have, need) {
  const set = new Set(have);
  return need.filter((c) => !set.has(c));
}

let client;
try {
  client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
} catch (e) {
  if (e instanceof Error && e.message.includes('Missing SUPABASE_DB_URL')) {
    console.log('SKIP_SMOKE_NO_DB_URL — configure DB URL para executar smoke de tickets.');
    process.exit(0);
  }
  throw e;
}

try {
  const checkCols = async (table, required) => {
    const { rows } = await client.query(
      `select column_name
         from information_schema.columns
        where table_schema = 'public' and table_name = $1`,
      [table]
    );
    const have = rows.map((r) => r.column_name);
    const missing = missingCols(have, required);
    if (missing.length) {
      throw new Error(`Faltam colunas em ${table}: ${missing.join(', ')}`);
    }
  };

  await checkCols('tickets', REQUIRED_TICKETS);
  await checkCols('ticket_events', REQUIRED_TICKET_EVENTS);

  const now = Date.now();
  const ticketCode = `SMOKE-TKT-${String(now).slice(-8)}`;
  const dueAt = new Date(now + 120 * 60000).toISOString();
  const workspaceRes = await client.query("select id from public.workspaces where is_active = true order by created_at limit 1");
  const workspaceId = workspaceRes.rows[0]?.id;
  if (!workspaceId) {
    console.log('SKIP_SMOKE_NO_WORKSPACE — nenhum workspace ativo disponível.');
    await client.end();
    process.exit(0);
  }

  await client.query('begin');

  const insTicket = await client.query(
    `insert into public.tickets
      (workspace_id, ticket_code, persona, type, priority, sla_minutes, channel_origin, status, due_at, context_snap, classifier_version)
     values
      ($1, $2, 'driver', 'payment', 'high', 120, 'whatsapp', 'open', $3, $4::jsonb, 'smoke-v1')
     returning id`,
    [workspaceId, ticketCode, dueAt, JSON.stringify({ smoke: true, note: 'context snapshot test' })]
  );

  const ticketId = insTicket.rows[0]?.id;
  if (!ticketId) throw new Error('Falha ao inserir ticket de smoke.');

  await client.query(
    `insert into public.ticket_events (workspace_id, ticket_id, event_type, payload)
     values ($1, $2, 'smoke_event', $3::jsonb)`,
    [workspaceId, ticketId, JSON.stringify({ ok: true })]
  );

  await client.query(
    `update public.tickets
        set status = 'in_progress', started_at = now(), updated_at = now()
      where id = $1`,
    [ticketId]
  );

  await client.query(
    `update public.tickets
        set status = 'resolved', resolved_at = now(), updated_at = now()
      where id = $1`,
    [ticketId]
  );

  await client.query('delete from public.ticket_events where ticket_id = $1', [ticketId]);
  await client.query('delete from public.tickets where id = $1', [ticketId]);

  await client.query('commit');
  console.log('OK: smoke ticketing/SLA DB (schema + ciclo minimo de ticket).');
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error('Smoke ticketing/SLA falhou:', e?.message || e);
  process.exit(1);
} finally {
  await client.end();
}

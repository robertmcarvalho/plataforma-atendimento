/**
 * Smoke DB: valida isolamento básico multi-tenant por workspace_id.
 * Cria dois workspaces temporários dentro de uma transação e executa rollback no final.
 *
 * Uso: npm run smoke:multitenant-isolation-db
 */
import pg from 'pg';
import { readDbUrl } from './lib/readDbUrl.mjs';

let client;
try {
  client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
} catch (e) {
  if (e instanceof Error && e.message.includes('Missing SUPABASE_DB_URL')) {
    console.log('SKIP_SMOKE_NO_DB_URL — configure DB URL para executar smoke multi-tenant.');
    process.exit(0);
  }
  throw e;
}

const suffix = String(Date.now());

try {
  await client.query('begin');

  const wsA = await client.query(
    `insert into public.workspaces (slug, display_name)
     values ($1, $2)
     returning id`,
    [`smoke-tenant-a-${suffix}`, `Smoke Tenant A ${suffix}`]
  );
  const wsB = await client.query(
    `insert into public.workspaces (slug, display_name)
     values ($1, $2)
     returning id`,
    [`smoke-tenant-b-${suffix}`, `Smoke Tenant B ${suffix}`]
  );

  const workspaceA = wsA.rows[0].id;
  const workspaceB = wsB.rows[0].id;

  const contactA = await client.query(
    `insert into public.contacts (workspace_id, wa_phone, display_name, profile_type)
     values ($1, $2, $3, 'unknown')
     returning id`,
    [workspaceA, `5591000${suffix.slice(-6)}`, `Contato A ${suffix}`]
  );
  const contactB = await client.query(
    `insert into public.contacts (workspace_id, wa_phone, display_name, profile_type)
     values ($1, $2, $3, 'unknown')
     returning id`,
    [workspaceB, `5592000${suffix.slice(-6)}`, `Contato B ${suffix}`]
  );

  const convA = await client.query(
    `insert into public.conversations (workspace_id, contact_id, status, priority, summary)
     values ($1, $2, 'open', 'normal', 'smoke tenant A')
     returning id`,
    [workspaceA, contactA.rows[0].id]
  );
  const convB = await client.query(
    `insert into public.conversations (workspace_id, contact_id, status, priority, summary)
     values ($1, $2, 'open', 'normal', 'smoke tenant B')
     returning id`,
    [workspaceB, contactB.rows[0].id]
  );

  const scopedA = await client.query(
    `select id from public.conversations where workspace_id = $1 order by created_at desc limit 20`,
    [workspaceA]
  );
  const scopedB = await client.query(
    `select id from public.conversations where workspace_id = $1 order by created_at desc limit 20`,
    [workspaceB]
  );

  const idsA = new Set(scopedA.rows.map((row) => row.id));
  const idsB = new Set(scopedB.rows.map((row) => row.id));
  if (!idsA.has(convA.rows[0].id) || idsA.has(convB.rows[0].id)) {
    throw new Error('Falha no isolamento de leitura do workspace A.');
  }
  if (!idsB.has(convB.rows[0].id) || idsB.has(convA.rows[0].id)) {
    throw new Error('Falha no isolamento de leitura do workspace B.');
  }

  const wrongUpdate = await client.query(
    `update public.conversations
        set summary = 'cross tenant update should not happen'
      where workspace_id = $1 and id = $2`,
    [workspaceA, convB.rows[0].id]
  );
  if (wrongUpdate.rowCount !== 0) {
    throw new Error('Update cross-tenant afetou linha de outro workspace.');
  }

  const wrongDelete = await client.query(
    `delete from public.contacts where workspace_id = $1 and id = $2`,
    [workspaceA, contactB.rows[0].id]
  );
  if (wrongDelete.rowCount !== 0) {
    throw new Error('Delete cross-tenant afetou linha de outro workspace.');
  }

  await client.query('rollback');
  console.log('OK: smoke multi-tenant DB (leitura/update/delete escopados + rollback).');
} catch (e) {
  await client.query('rollback').catch(() => undefined);
  console.error('Smoke multi-tenant falhou:', e?.message || e);
  process.exit(1);
} finally {
  await client.end();
}

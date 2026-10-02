#!/usr/bin/env node
/**
 * Remove atendimentos completos (conversas + dependências) de um número de teste.
 * Uso: node scripts/db/purge-test-phone-attendance.mjs 3496710044 [--dry-run]
 */
import { Client } from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const phone = (process.argv[2] || '').replace(/\D/g, '');
const dryRun = process.argv.includes('--dry-run');

if (!phone) {
  console.error('Uso: node scripts/db/purge-test-phone-attendance.mjs 3496710044 [--dry-run]');
  process.exit(1);
}

const client = new Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });

async function countBy(client, sql, params) {
  const { rows } = await client.query(sql, params);
  return Number(rows[0]?.n ?? 0);
}

async function main() {
  await client.connect();
  try {
    const { rows: contacts } = await client.query(
      `SELECT id, wa_phone, display_name, workspace_id
       FROM contacts
       WHERE regexp_replace(wa_phone, '\\D', '', 'g') LIKE '%' || $1`,
      [phone],
    );

    if (!contacts.length) {
      console.log(`Nenhum contato encontrado contendo ${phone}.`);
      return;
    }

    const contactIds = contacts.map((c) => c.id);
    const { rows: convs } = await client.query(
      `SELECT id, status, created_at, resolved_at, workspace_id
       FROM conversations
       WHERE contact_id = ANY($1::uuid[])
       ORDER BY created_at`,
      [contactIds],
    );
    const convIds = convs.map((c) => c.id);

    const preview = {
      phone,
      dryRun,
      contacts: contacts.map((c) => ({ id: c.id, wa_phone: c.wa_phone, display_name: c.display_name })),
      conversations: convs.length,
      messages: convIds.length
        ? await countBy(client, `SELECT count(*)::int AS n FROM messages WHERE conversation_id = ANY($1::uuid[])`, [convIds])
        : 0,
      bot_sessions: await countBy(
        client,
        `SELECT count(*)::int AS n FROM bot_sessions WHERE contact_id = ANY($1::uuid[])`,
        [contactIds],
      ),
      pending_tasks: await countBy(
        client,
        `SELECT count(*)::int AS n FROM pending_tasks
         WHERE ($1::uuid[] <> '{}' AND conversation_id = ANY($1::uuid[]))
            OR contact_id = ANY($2::uuid[])`,
        [convIds, contactIds],
      ),
      contact_csat_dispatches: await countBy(
        client,
        `SELECT count(*)::int AS n FROM contact_csat_dispatches
         WHERE contact_id = ANY($1::uuid[])
            OR ($2::uuid[] <> '{}' AND conversation_id = ANY($2::uuid[]))`,
        [contactIds, convIds],
      ),
      tickets_linked: convIds.length
        ? await countBy(client, `SELECT count(*)::int AS n FROM tickets WHERE conversation_id = ANY($1::uuid[])`, [convIds])
        : 0,
    };

    console.log('Prévia:', JSON.stringify(preview, null, 2));
    if (dryRun || !convIds.length) return;

    await client.query('BEGIN');

    if (convIds.length) {
      await client.query(
        `UPDATE commercial_leads SET primary_conversation_id = NULL WHERE primary_conversation_id = ANY($1::uuid[])`,
        [convIds],
      );
      await client.query(`UPDATE tickets SET conversation_id = NULL WHERE conversation_id = ANY($1::uuid[])`, [convIds]);
      await client.query(`DELETE FROM contact_csat_dispatches WHERE conversation_id = ANY($1::uuid[])`, [convIds]);
      await client.query(
        `DELETE FROM pending_tasks WHERE conversation_id = ANY($1::uuid[]) OR contact_id = ANY($2::uuid[])`,
        [convIds, contactIds],
      );
      await client.query(`DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [convIds]);
    }

    await client.query(`DELETE FROM bot_sessions WHERE contact_id = ANY($1::uuid[])`, [contactIds]);

    await client.query('COMMIT');

    const { rows: remaining } = await client.query(
      `SELECT count(*)::int AS n FROM conversations WHERE contact_id = ANY($1::uuid[])`,
      [contactIds],
    );

    const workspaceId = contacts[0]?.workspace_id;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { rows: dash } = workspaceId
      ? await client.query(
          `SELECT
             (SELECT count(*)::int FROM conversations WHERE workspace_id = $1 AND created_at >= $2) AS conversations_last_24h,
             (SELECT count(*)::int FROM conversations WHERE workspace_id = $1 AND created_at >= $3) AS conversations_today`,
          [workspaceId, since24h, today.toISOString()],
        )
      : { rows: [{}] };

    console.log(
      JSON.stringify(
        {
          ok: true,
          deletedConversations: convIds.length,
          remainingConversations: remaining[0]?.n ?? 0,
          dashboard: dash[0],
        },
        null,
        2,
      ),
    );
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

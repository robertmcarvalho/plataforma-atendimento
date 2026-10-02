#!/usr/bin/env node
/**
 * Remove mensagens (e metadados de conversa) de um número de teste.
 * Uso: node scripts/db/purge-test-phone-messages.mjs 3496710044
 */
import { Client } from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const phone = (process.argv[2] || '').replace(/\D/g, '');
if (!phone) {
  console.error('Informe o número: node scripts/db/purge-test-phone-messages.mjs 3496710044');
  process.exit(1);
}

const client = new Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  try {
    await client.query('BEGIN');

    const { rows: contacts } = await client.query(
      `SELECT id, wa_phone, display_name, profile_type
       FROM contacts
       WHERE regexp_replace(wa_phone, '\\D', '', 'g') LIKE '%' || $1`,
      [phone],
    );

    if (!contacts.length) {
      console.log(`Nenhum contato encontrado contendo ${phone}.`);
      await client.query('ROLLBACK');
      return;
    }

    const contactIds = contacts.map((c) => c.id);
    const { rows: convs } = await client.query(
      `SELECT id, status, last_message_at
       FROM conversations
       WHERE contact_id = ANY($1::uuid[])`,
      [contactIds],
    );
    const convIds = convs.map((c) => c.id);

    let deletedMessages = 0;
    if (convIds.length) {
      const del = await client.query(
        `DELETE FROM messages WHERE conversation_id = ANY($1::uuid[])`,
        [convIds],
      );
      deletedMessages = del.rowCount ?? 0;

      await client.query(
        `UPDATE conversations
         SET last_message_at = NULL,
             human_handoff_at = NULL,
             attendant_id = NULL,
             updated_at = now()
         WHERE id = ANY($1::uuid[])`,
        [convIds],
      );
    }

    await client.query('COMMIT');

    console.log(
      JSON.stringify(
        {
          phone,
          contacts: contacts.map((c) => ({ id: c.id, wa_phone: c.wa_phone, display_name: c.display_name })),
          conversations: convIds.length,
          deletedMessages,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

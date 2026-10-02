import fs from 'node:fs';
import pg from 'pg';

const dbUrl = fs.readFileSync('.secrets/production-db-url.txt', 'utf8').trim();
const leaderId = process.argv[2] || 'a55e5e53-194a-4c6c-9361-da2bd2014ae3';
const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await c.connect();
const { rows: contacts } = await c.query(
  `SELECT id, wa_phone, display_name, profile_type, leader_id, updated_at
   FROM contacts WHERE leader_id = $1 OR wa_phone LIKE '%3496710044%'`,
  [leaderId],
);
let convs = { rows: [] };
if (contacts.length) {
  convs = await c.query(
    `SELECT c.id, c.status, c.last_message_at, c.last_message_direction,
            (SELECT count(*) FROM messages m WHERE m.conversation_id = c.id) AS msg_count
     FROM conversations c
     WHERE c.contact_id = ANY($1::uuid[])
     ORDER BY c.last_message_at DESC NULLS LAST LIMIT 5`,
    [contacts.map((x) => x.id)],
  );
}
console.log(JSON.stringify({ contacts, conversations: convs.rows }, null, 2));
await c.end();

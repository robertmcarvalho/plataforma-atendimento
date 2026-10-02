#!/usr/bin/env node
/**
 * Remove registros de uma pessoa por telefone/e-mail/nome.
 * Uso: node scripts/db/purge-person-by-identity.mjs --phone=3496710044 --email=rbtcarvalhi@gmail.com --name="Robert Magdiel"
 */
import { Client } from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

function parseArgs(argv) {
  const out = { dryRun: argv.includes('--dry-run') };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--phone=')) out.phone = arg.slice(8).replace(/\D/g, '');
    if (arg.startsWith('--email=')) out.email = arg.slice(8).trim().toLowerCase();
    if (arg.startsWith('--name=')) out.name = arg.slice(7).trim();
  }
  return out;
}

const args = parseArgs(process.argv);
if (!args.phone && !args.email && !args.name) {
  console.error('Informe --phone, --email e/ou --name');
  process.exit(1);
}

const client = new Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });

async function q(sql, params = []) {
  const { rows } = await client.query(sql, params);
  return rows;
}

async function count(sql, params = []) {
  const rows = await q(sql, params);
  return Number(rows[0]?.n ?? 0);
}

function namePattern(name) {
  return `%${name.replace(/\s+/g, '%')}%`;
}

async function discover() {
  const phoneLike = args.phone ? `%${args.phone}` : null;
  const email = args.email || null;
  const nameLike = args.name ? namePattern(args.name) : null;

  const users = await q(
    `SELECT id, email, name, phone FROM users
     WHERE ($1::text IS NOT NULL AND lower(email) = $1)
        OR ($2::text IS NOT NULL AND regexp_replace(coalesce(phone,''), '\\D', '', 'g') LIKE $2)
        OR ($3::text IS NOT NULL AND name ILIKE $3)`,
    [email, phoneLike, nameLike],
  );

  const contacts = await q(
    `SELECT id, wa_phone, display_name, profile_type, driver_id, leader_id, commercial_lead_id, workspace_id
     FROM contacts
     WHERE ($1::text IS NOT NULL AND regexp_replace(wa_phone, '\\D', '', 'g') LIKE $1)
        OR ($2::text IS NOT NULL AND display_name ILIKE $2)`,
    [phoneLike, nameLike],
  );

  const drivers = await q(
    `SELECT id, name, phone, email, cpf, workspace_id FROM drivers
     WHERE ($1::text IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE $1)
        OR ($2::text IS NOT NULL AND lower(coalesce(email,'')) = $2)
        OR ($3::text IS NOT NULL AND name ILIKE $3)`,
    [phoneLike, email, nameLike],
  );

  const leaders = await q(
    `SELECT id, name, phone, email, user_id, workspace_id FROM leaders
     WHERE ($1::text IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE $1)
        OR ($2::text IS NOT NULL AND lower(coalesce(email,'')) = $2)
        OR ($3::text IS NOT NULL AND name ILIKE $3)`,
    [phoneLike, email, nameLike],
  );

  const commercialLeads = await q(
    `SELECT id, trade_name, contact_name, phone, contact_email, primary_conversation_id, workspace_id
     FROM commercial_leads
     WHERE ($1::text IS NOT NULL AND regexp_replace(phone, '\\D', '', 'g') LIKE $1)
        OR ($2::text IS NOT NULL AND lower(coalesce(contact_email,'')) = $2)
        OR ($3::text IS NOT NULL AND (trade_name ILIKE $3 OR contact_name ILIKE $3))`,
    [phoneLike, email, nameLike],
  );

  const contactIds = contacts.map((r) => r.id);
  const driverIds = drivers.map((r) => r.id);
  const leaderIds = leaders.map((r) => r.id);
  const userIds = users.map((r) => r.id);
  const leadIds = commercialLeads.map((r) => r.id);

  const convs = contactIds.length
    ? await q(`SELECT id FROM conversations WHERE contact_id = ANY($1::uuid[])`, [contactIds])
    : [];
  const convIds = convs.map((r) => r.id);

  const extraConvs =
    leadIds.length || driverIds.length || leaderIds.length
      ? await q(
          `SELECT id FROM conversations
           WHERE ($1::uuid[] <> '{}' AND context_commercial_lead_id = ANY($1::uuid[]))
              OR ($2::uuid[] <> '{}' AND context_driver_id = ANY($2::uuid[]))
              OR ($3::uuid[] <> '{}' AND context_leader_id = ANY($3::uuid[]))`,
          [leadIds, driverIds, leaderIds],
        )
      : [];
  for (const row of extraConvs) {
    if (!convIds.includes(row.id)) convIds.push(row.id);
  }

  return { users, contacts, drivers, leaders, commercialLeads, convIds, contactIds, driverIds, leaderIds, userIds, leadIds };
}

async function execStep(label, sql, params = []) {
  try {
    const res = await client.query(sql, params);
    return { label, rowCount: res.rowCount ?? 0 };
  } catch (err) {
    err.step = label;
    throw err;
  }
}

async function purge(found) {
  const { convIds, contactIds, driverIds, leaderIds, userIds, leadIds } = found;
  const steps = [];

  await client.query('BEGIN');

  if (convIds.length) {
    steps.push(await execStep('commercial_leads.null_conv', `UPDATE commercial_leads SET primary_conversation_id = NULL WHERE primary_conversation_id = ANY($1::uuid[])`, [convIds]));
    steps.push(await execStep('tickets.null_conv', `UPDATE tickets SET conversation_id = NULL WHERE conversation_id = ANY($1::uuid[])`, [convIds]));
    steps.push(await execStep('contact_csat.delete_conv', `DELETE FROM contact_csat_dispatches WHERE conversation_id = ANY($1::uuid[])`, [convIds]));
    steps.push(
      await execStep(
        'pending_tasks.delete_conv',
        `DELETE FROM pending_tasks
         WHERE conversation_id = ANY($1::uuid[])
            OR contact_id = ANY($2::uuid[])
            OR ($3::uuid[] <> '{}' AND driver_id = ANY($3::uuid[]))`,
        [convIds, contactIds, driverIds],
      ),
    );
    steps.push(await execStep('conversations.delete', `DELETE FROM conversations WHERE id = ANY($1::uuid[])`, [convIds]));
  }

  if (driverIds.length) {
    const { rows: ticketRows } = await client.query(`SELECT id FROM tickets WHERE driver_id = ANY($1::uuid[])`, [driverIds]);
    const ticketIds = ticketRows.map((r) => r.id);
    if (ticketIds.length) {
      steps.push(await execStep('ticket_events.delete', `DELETE FROM ticket_events WHERE ticket_id = ANY($1::uuid[])`, [ticketIds]));
      steps.push(await execStep('tickets.delete_driver', `DELETE FROM tickets WHERE id = ANY($1::uuid[])`, [ticketIds]));
    }

    const { rows: entryRows } = await client.query(`SELECT id FROM financial_entries WHERE driver_id = ANY($1::uuid[])`, [driverIds]);
    const entryIds = entryRows.map((r) => r.id);
    if (entryIds.length) {
      steps.push(await execStep('financial_installments.delete', `DELETE FROM financial_installments WHERE entry_id = ANY($1::uuid[])`, [entryIds]));
      steps.push(await execStep('financial_entries.delete', `DELETE FROM financial_entries WHERE id = ANY($1::uuid[])`, [entryIds]));
    }

    steps.push(await execStep('driver_pharmacy_links.delete', `DELETE FROM driver_pharmacy_links WHERE driver_id = ANY($1::uuid[])`, [driverIds]));
    steps.push(await execStep('contacts.null_driver', `UPDATE contacts SET driver_id = NULL WHERE driver_id = ANY($1::uuid[])`, [driverIds]));
    steps.push(await execStep('drivers.delete', `DELETE FROM drivers WHERE id = ANY($1::uuid[])`, [driverIds]));
  }

  if (leaderIds.length) {
    steps.push(await execStep('pharmacies.null_leader', `UPDATE pharmacies SET leader_id = NULL WHERE leader_id = ANY($1::uuid[])`, [leaderIds]));
    steps.push(await execStep('tickets.null_leader', `UPDATE tickets SET leader_id = NULL WHERE leader_id = ANY($1::uuid[])`, [leaderIds]));
    steps.push(
      await execStep(
        'leader_whatsapp_verifications.delete',
        `DELETE FROM leader_whatsapp_verifications WHERE leader_id = ANY($1::uuid[])`,
        [leaderIds],
      ),
    );
    steps.push(await execStep('leaders.null_user', `UPDATE leaders SET user_id = NULL WHERE id = ANY($1::uuid[])`, [leaderIds]));
    steps.push(await execStep('leaders.delete', `DELETE FROM leaders WHERE id = ANY($1::uuid[])`, [leaderIds]));
  }

  if (contactIds.length) {
    steps.push(await execStep('contact_csat.delete_contact', `DELETE FROM contact_csat_dispatches WHERE contact_id = ANY($1::uuid[])`, [contactIds]));
    steps.push(await execStep('bot_sessions.delete', `DELETE FROM bot_sessions WHERE contact_id = ANY($1::uuid[])`, [contactIds]));
    steps.push(await execStep('contacts.delete', `DELETE FROM contacts WHERE id = ANY($1::uuid[])`, [contactIds]));
  }

  if (leadIds.length) {
    steps.push(await execStep('commercial_lead_activities.delete', `DELETE FROM commercial_lead_activities WHERE lead_id = ANY($1::uuid[])`, [leadIds]));
    steps.push(await execStep('commercial_leads.delete', `DELETE FROM commercial_leads WHERE id = ANY($1::uuid[])`, [leadIds]));
  }

  if (userIds.length) {
    steps.push(await execStep('conversations.null_attendant', `UPDATE conversations SET attendant_id = NULL WHERE attendant_id = ANY($1::uuid[])`, [userIds]));
    steps.push(await execStep('workspace_memberships.delete', `DELETE FROM workspace_memberships WHERE user_id = ANY($1::uuid[])`, [userIds]));
    steps.push(await execStep('user_channel_queue_assignments.delete', `DELETE FROM user_channel_queue_assignments WHERE user_id = ANY($1::uuid[])`, [userIds]));
    steps.push(await execStep('user_sectors.delete', `DELETE FROM user_sectors WHERE user_id = ANY($1::uuid[])`, [userIds]));
    steps.push(await execStep('users.delete', `DELETE FROM users WHERE id = ANY($1::uuid[])`, [userIds]));
    steps.push(await execStep('auth.users.delete', `DELETE FROM auth.users WHERE id = ANY($1::uuid[])`, [userIds]));
  }

  await client.query('COMMIT');

  return {
    deleted: {
      users: userIds.length,
      contacts: contactIds.length,
      drivers: driverIds.length,
      leaders: leaderIds.length,
      commercial_leads: leadIds.length,
      conversations: convIds.length,
    },
    steps,
  };
}

async function main() {
  await client.connect();
  try {
    const found = await discover();
    const summary = {
      args,
      dryRun: args.dryRun,
      found: {
        users: found.users,
        contacts: found.contacts,
        drivers: found.drivers,
        leaders: found.leaders,
        commercial_leads: found.commercialLeads,
        conversations: found.convIds.length,
      },
    };

    const empty =
      !found.users.length &&
      !found.contacts.length &&
      !found.drivers.length &&
      !found.leaders.length &&
      !found.commercialLeads.length &&
      !found.convIds.length;

    console.log(JSON.stringify(summary, null, 2));
    if (empty) return;
    if (args.dryRun) return;

    const result = await purge(found);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  if (err.step) console.error(`Falha em: ${err.step}`);
  console.error(err.message || err);
  process.exit(1);
});

#!/usr/bin/env node
import { Client } from 'pg';
import { readDbUrl } from '../lib/readDbUrl.mjs';

const driverId = '549c0f2b-45c6-4fed-aa4e-ee138074eddc';
const leaderId = 'a55e5e53-194a-4c6c-9361-da2bd2014ae3';
const userId = 'a836d730-cb84-4eaf-bc83-08fcc6c32864';
const contactId = '33931fa4-2833-4cc8-9b03-891c15c08238';

const client = new Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();

const checks = [
  ['conversations by contact', `SELECT id,status FROM conversations WHERE contact_id=$1`, [contactId]],
  ['conversations context_driver', `SELECT id FROM conversations WHERE context_driver_id=$1`, [driverId]],
  ['conversations context_leader', `SELECT id FROM conversations WHERE context_leader_id=$1`, [leaderId]],
  ['bot_sessions', `SELECT count(*)::int n FROM bot_sessions WHERE contact_id=$1`, [contactId]],
  ['tickets driver', `SELECT count(*)::int n FROM tickets WHERE driver_id=$1`, [driverId]],
  ['tickets leader', `SELECT count(*)::int n FROM tickets WHERE leader_id=$1`, [leaderId]],
  ['pending_tasks driver', `SELECT count(*)::int n FROM pending_tasks WHERE driver_id=$1`, [driverId]],
  ['pharmacies leader', `SELECT count(*)::int n FROM pharmacies WHERE leader_id=$1`, [leaderId]],
  ['driver_pharmacies', `SELECT count(*)::int n FROM driver_pharmacies WHERE driver_id=$1`, [driverId]],
  ['financial_entries driver', `SELECT count(*)::int n FROM financial_entries WHERE driver_id=$1`, [driverId]],
  ['supply_requests', `SELECT count(*)::int n FROM supply_requests WHERE driver_id=$1 OR leader_id=$2`, [driverId, leaderId]],
  ['workspace_members user', `SELECT count(*)::int n FROM workspace_members WHERE user_id=$1`, [userId]],
];

for (const [label, sql, params] of checks) {
  try {
    const { rows } = await client.query(sql, params);
    console.log(label, rows);
  } catch (e) {
    console.log(label, 'ERR', e.message);
  }
}

await client.end();

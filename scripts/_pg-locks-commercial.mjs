import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = fs.readFileSync(path.join(repoRoot, '.secrets', 'production-db-url.txt'), 'utf8').trim();
const c = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await c.connect();
const locks = await c.query(`
  SELECT l.pid, l.mode, l.granted, a.query, c.relname
  FROM pg_locks l
  JOIN pg_class c ON c.oid = l.relation
  LEFT JOIN pg_stat_activity a ON a.pid = l.pid
  WHERE c.relname LIKE 'commercial%'
`);
console.log('locks', locks.rows);
const act = await c.query(`
  SELECT pid, state, wait_event_type, wait_event, left(query, 120) AS query
  FROM pg_stat_activity
  WHERE query ILIKE '%commercial%' AND state <> 'idle'
`);
console.log('activity', act.rows);
await c.end();

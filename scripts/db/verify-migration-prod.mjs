import { readFileSync } from 'fs';
import pg from 'pg';

const c = new pg.Client({
  connectionString: readFileSync('.secrets/production-db-url.txt', 'utf8').trim(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const auth = await c.query(`SELECT id, email FROM auth.users WHERE deleted_at IS NULL ORDER BY email`);
const pub = await c.query(`SELECT id, email, platform_role FROM public.users ORDER BY email`);
const ch = await c.query(`SELECT channel_type, provider, status, is_default FROM public.workspace_channels ORDER BY channel_type`);
console.log(JSON.stringify({ auth: auth.rows, public_users: pub.rows, channels: ch.rows }, null, 2));
await c.end();

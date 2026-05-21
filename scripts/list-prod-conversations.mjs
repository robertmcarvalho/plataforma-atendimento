#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import pg from 'pg';
import { resolveProductionDbUrl } from './lib/loadProdEnv.mjs';

const c = new pg.Client({
  connectionString: resolveProductionDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();
const total = await c.query('SELECT COUNT(*)::int c FROM public.conversations');
const byTag = await c.query(
  `SELECT unnest(tags) AS tag, COUNT(*)::int c FROM public.conversations
   WHERE tags IS NOT NULL AND array_length(tags, 1) > 0 GROUP BY 1 ORDER BY c DESC`
);
const sample = await c.query(
  `SELECT c.id, c.status, c.summary, c.tags, ct.display_name, ct.wa_phone
   FROM public.conversations c
   LEFT JOIN public.contacts ct ON ct.id = c.contact_id
   ORDER BY c.last_message_at DESC NULLS LAST LIMIT 20`
);
const smokeSummary = await c.query(
  `SELECT COUNT(*)::int c FROM public.conversations
   WHERE summary ILIKE '%smoke%' OR summary ILIKE '%staging%' OR summary ILIKE '%teste%'`
);
await c.end();
console.log(
  JSON.stringify(
    { total: total.rows[0].c, smoke_summary: smokeSummary.rows[0].c, by_tag: byTag.rows, sample: sample.rows },
    null,
    2
  )
);

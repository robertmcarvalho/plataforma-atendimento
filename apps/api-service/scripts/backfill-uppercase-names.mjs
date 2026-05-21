/**
 * Normaliza name/trade_name/legal_name para UPPERCASE (pt-BR), espacos colapsados.
 *
 * Uso:
 *   node apps/api-service/scripts/backfill-uppercase-names.mjs --dry-run
 *   node apps/api-service/scripts/backfill-uppercase-names.mjs --apply
 *
 * Requer: SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no ambiente ou em apps/api-service/.env
 */
import { createClient } from '@supabase/supabase-js';
import { config } from 'dotenv';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: resolve(__dirname, '../.env') });

function norm(s) {
  if (s == null || s === '') return s;
  return String(s).replace(/\s+/g, ' ').trim().toLocaleUpperCase('pt-BR');
}

const PAGE = 500;
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const dryRun = args.includes('--dry-run') || !apply;

const url = process.env.SUPABASE_URL || '';
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!url || !key) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY.');
  process.exit(1);
}

const supabase = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });

async function pageTable(table, selectCols) {
  let from = 0;
  const all = [];
  while (true) {
    const { data, error } = await supabase.from(table).select(selectCols).range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function main() {
  console.log(dryRun ? 'Modo DRY-RUN (sem gravar). Use --apply para atualizar.' : 'Modo APPLY — gravando alteracoes.');

  let totalSeen = 0;
  let totalChanged = 0;
  const samples = [];

  // drivers.name
  const drivers = await pageTable('drivers', 'id, name');
  totalSeen += drivers.length;
  for (const row of drivers) {
    const n = norm(row.name);
    if (n !== row.name) {
      totalChanged += 1;
      if (samples.length < 5) samples.push({ table: 'drivers', id: row.id, before: row.name, after: n });
      if (!dryRun) {
        const { error } = await supabase.from('drivers').update({ name: n, updated_at: new Date().toISOString() }).eq('id', row.id);
        if (error) throw error;
      }
    }
  }

  // pharmacies.trade_name, legal_name
  const pharmacies = await pageTable('pharmacies', 'id, trade_name, legal_name');
  totalSeen += pharmacies.length;
  for (const row of pharmacies) {
    const tn = norm(row.trade_name);
    const ln = row.legal_name != null ? norm(row.legal_name) : row.legal_name;
    const patch = {};
    if (tn !== row.trade_name) patch.trade_name = tn;
    if (ln !== row.legal_name) patch.legal_name = ln;
    if (Object.keys(patch).length) {
      totalChanged += 1;
      if (samples.length < 5)
        samples.push({
          table: 'pharmacies',
          id: row.id,
          before: { trade_name: row.trade_name, legal_name: row.legal_name },
          after: patch,
        });
      if (!dryRun) {
        const { error } = await supabase
          .from('pharmacies')
          .update({ ...patch, updated_at: new Date().toISOString() })
          .eq('id', row.id);
        if (error) throw error;
      }
    }
  }

  // leaders.name
  const leaders = await pageTable('leaders', 'id, name');
  totalSeen += leaders.length;
  for (const row of leaders) {
    const n = norm(row.name);
    if (n !== row.name) {
      totalChanged += 1;
      if (samples.length < 5) samples.push({ table: 'leaders', id: row.id, before: row.name, after: n });
      if (!dryRun) {
        const { error } = await supabase.from('leaders').update({ name: n, updated_at: new Date().toISOString() }).eq('id', row.id);
        if (error) throw error;
      }
    }
  }

  console.log(JSON.stringify({ totalSeen, totalChanged, samples }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

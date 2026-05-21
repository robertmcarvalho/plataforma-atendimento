import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), 'apps', 'api-service', '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    execute: argv.includes('--execute'),
    confirm: process.env.CONFIRM_FIX_QUOTA_STATUS === 'true',
  };
}

async function main() {
  const { execute, confirm } = parseArgs();
  const { data: entries, error: selectError } = await supabase
    .from('financial_entries')
    .select('id, type, status, driver_id, description')
    .eq('type', 'quota')
    .eq('status', 'pending_approval');

  if (selectError) {
    console.error('Erro ao consultar lançamentos:', selectError.message);
    process.exit(1);
  }

  console.log(`Encontrados ${entries.length} lançamento(s) de cota com status pending_approval.`);
  for (const entry of entries) {
    console.log(`- ${entry.id} | driver ${entry.driver_id} | ${entry.description || 'sem descrição'}`);
  }

  if (entries.length === 0) {
    return;
  }

  if (!execute) {
    console.log('Dry-run: nenhum lançamento foi alterado. Reexecute com --execute e CONFIRM_FIX_QUOTA_STATUS=true para aplicar.');
    return;
  }

  if (!confirm) {
    throw new Error('Confirmação ausente. Defina CONFIRM_FIX_QUOTA_STATUS=true para executar a alteração.');
  }

  const ids = entries.map((entry) => entry.id);
  const { data: updated, error: updateError } = await supabase
    .from('financial_entries')
    .update({ status: 'active', updated_at: new Date().toISOString() })
    .in('id', ids)
    .select('id, type, status');

  if (updateError) {
    console.error('Erro ao atualizar lançamentos:', updateError.message);
    process.exit(1);
  }

  console.log(`Atualizado ${updated.length} lançamento(s) para status active.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
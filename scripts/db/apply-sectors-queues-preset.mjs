/**
 * Cria/atualiza os 4 setores macro no workspace e aplica preset de filas + SLA no canal WhatsApp.
 *
 * Uso:
 *   node scripts/apply-sectors-queues-preset.mjs
 *   node scripts/apply-sectors-queues-preset.mjs --workspace-slug flux-farma
 *   node scripts/apply-sectors-queues-preset.mjs --dry-run
 *   node scripts/apply-sectors-queues-preset.mjs --channel-id <uuid>
 *
 * Credenciais: apps/api-service/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';
import {
  MACRO_SECTOR_NAMES,
  buildChannelOperationalConfig,
  printPresetSummary,
} from '../lib/operational-sectors-queues-preset.mjs';

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return new Map();
  const values = new Map();
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    values.set(line.slice(0, idx).trim(), line.slice(idx + 1).trim());
  }
  return values;
}

function parseArgs(argv) {
  const out = { dryRun: false, workspaceSlug: process.env.WORKSPACE_SLUG || 'default', channelId: null };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--workspace-slug' && argv[i + 1]) {
      out.workspaceSlug = argv[++i];
    } else if (a === '--channel-id' && argv[i + 1]) {
      out.channelId = argv[++i];
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv);
  const envPath = path.join(process.cwd(), 'apps', 'api-service', '.env');
  const envValues = parseEnvFile(envPath);
  const url = process.env.SUPABASE_URL || envValues.get('SUPABASE_URL');
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || envValues.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) {
    console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY em apps/api-service/.env');
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });

  const { data: workspace, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, slug, display_name')
    .eq('slug', args.workspaceSlug)
    .maybeSingle();
  if (wsErr) throw new Error(wsErr.message);
  if (!workspace?.id) {
    console.error(`Workspace slug="${args.workspaceSlug}" não encontrado.`);
    process.exit(1);
  }

  const workspaceId = workspace.id;
  console.log(`Workspace: ${workspace.display_name || workspace.slug} (${workspaceId})`);

  const sectorIdByName = {};
  const now = new Date().toISOString();

  for (const name of MACRO_SECTOR_NAMES) {
    const { data: existing } = await supabase
      .from('sectors')
      .select('id, name, is_active')
      .eq('workspace_id', workspaceId)
      .eq('name', name)
      .maybeSingle();

    if (existing?.id) {
      if (!existing.is_active && !args.dryRun) {
        await supabase.from('sectors').update({ is_active: true, updated_at: now }).eq('id', existing.id);
      }
      sectorIdByName[name] = existing.id;
      console.log(`Setor já existe: ${name} → ${existing.id}`);
      continue;
    }

    if (args.dryRun) {
      sectorIdByName[name] = `(novo-${name})`;
      console.log(`[dry-run] Criaria setor: ${name}`);
      continue;
    }

    const { data: inserted, error: insErr } = await supabase
      .from('sectors')
      .insert({
        workspace_id: workspaceId,
        name,
        description: `Setor macro — ${name}`,
        is_active: true,
        business_hours: {},
      })
      .select('id')
      .single();
    if (insErr) throw new Error(`Insert sector ${name}: ${insErr.message}`);
    sectorIdByName[name] = inserted.id;
    console.log(`Setor criado: ${name} → ${inserted.id}`);
  }

  const missing = MACRO_SECTOR_NAMES.filter((n) => !sectorIdByName[n] || String(sectorIdByName[n]).startsWith('(novo'));
  if (missing.length && !args.dryRun) {
    throw new Error(`Setores incompletos: ${missing.join(', ')}`);
  }

  printPresetSummary(sectorIdByName);

  let channelQuery = supabase
    .from('workspace_channels')
    .select('id, display_name, channel_type, config')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .order('is_default', { ascending: false });

  if (args.channelId) {
    channelQuery = channelQuery.eq('id', args.channelId);
  }

  const { data: channels, error: chErr } = await channelQuery;
  if (chErr) throw new Error(chErr.message);

  const channel = (channels || [])[0];
  if (!channel) {
    console.warn('\nNenhum canal WhatsApp encontrado. Setores criados no banco; configure o canal em Configurações → Canais.');
    console.warn('Depois rode novamente este script ou copie o preset de docs/SETORES_FILAS_PRESET.md\n');
    return;
  }

  const operational = buildChannelOperationalConfig(sectorIdByName);
  const nextConfig = {
    ...(channel.config && typeof channel.config === 'object' ? channel.config : {}),
    ...operational,
  };

  if (args.dryRun) {
    console.log(`[dry-run] Atualizaria canal WhatsApp: ${channel.display_name || channel.id}`);
    return;
  }

  const { error: updErr } = await supabase
    .from('workspace_channels')
    .update({ config: nextConfig, updated_at: now })
    .eq('id', channel.id)
    .eq('workspace_id', workspaceId);
  if (updErr) throw new Error(`Update channel: ${updErr.message}`);

  console.log(`\nCanal WhatsApp atualizado: ${channel.display_name || channel.id}`);
  console.log('Próximos passos:');
  console.log('  1. Configurações → Canais → revisar aba Setores & Filas e Demandas');
  console.log('  2. Usuários → atendentes → Filas WhatsApp (marcar setores por canal)');
  console.log('  3. Teste E2E: mensagem inbound → menu de setores → demanda\n');
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});

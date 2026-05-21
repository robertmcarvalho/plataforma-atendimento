/**
 * Copia workspace_flow_messages → workspace_channels.config.messages.intake
 * para o canal WhatsApp/Instagram informado (ou todos do workspace).
 *
 * Uso:
 *   node scripts/migrate-channel-intake-messages.mjs --workspace-id=<uuid>
 *   node scripts/migrate-channel-intake-messages.mjs --workspace-id=<uuid> --channel-id=<uuid>
 */
import { createClient } from '@supabase/supabase-js';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? 'true'];
  })
);

const workspaceId = args['workspace-id'];
const channelId = args['channel-id'];

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('Defina SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
if (!workspaceId) {
  console.error('Informe --workspace-id=<uuid>');
  process.exit(1);
}

const db = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function parseMessages(config) {
  const c = config && typeof config === 'object' ? config : {};
  const m = c.messages && typeof c.messages === 'object' ? c.messages : {};
  const intake = m.intake && typeof m.intake === 'object' ? { ...m.intake } : {};
  return { config: c, messages: m, intake };
}

async function main() {
  const { data: flowRows, error: flowErr } = await db
    .from('workspace_flow_messages')
    .select('message_key, content')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true);
  if (flowErr) throw flowErr;

  const patch = {};
  for (const row of flowRows || []) {
    const key = String(row.message_key || '').trim();
    const content = String(row.content || '').trim();
    if (key && content) patch[key] = content;
  }

  let q = db
    .from('workspace_channels')
    .select('id, channel_type, config')
    .eq('workspace_id', workspaceId)
    .in('channel_type', ['whatsapp', 'instagram']);
  if (channelId) q = q.eq('id', channelId);
  const { data: channels, error: chErr } = await q;
  if (chErr) throw chErr;
  if (!channels?.length) {
    console.log('Nenhum canal de mensageria encontrado.');
    return;
  }

  for (const ch of channels) {
    const { config, intake } = parseMessages(ch.config);
    const nextIntake = { ...intake, ...patch };
    const nextConfig = {
      ...config,
      messages: {
        ...config.messages,
        intake: nextIntake,
      },
    };
    const { error } = await db.from('workspace_channels').update({ config: nextConfig }).eq('id', ch.id);
    if (error) {
      console.error(`Falha canal ${ch.id}:`, error.message);
      continue;
    }
    console.log(`OK canal ${ch.id} (${ch.channel_type}) — ${Object.keys(patch).length} chaves legadas aplicadas`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

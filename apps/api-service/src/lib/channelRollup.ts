import { supabase } from './supabase';

/** Atualiza `messages_24h` e `last_message_at` em `workspace_channels` a partir de `messages`. */
export async function rollupWorkspaceChannelStats(workspaceId?: string): Promise<{ updated: number }> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  let channelsQuery = supabase.from('workspace_channels').select('id, workspace_id');
  if (workspaceId) channelsQuery = channelsQuery.eq('workspace_id', workspaceId);
  const { data: channels, error: chErr } = await channelsQuery;
  if (chErr) throw new Error(chErr.message);
  if (!channels?.length) return { updated: 0 };

  let updated = 0;
  for (const ch of channels) {
    const wsId = String(ch.workspace_id);
    const chId = String(ch.id);

    const { count, error: countErr } = await supabase
      .from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', wsId)
      .gte('created_at', since);
    if (countErr) continue;

    const { data: lastMsg } = await supabase
      .from('messages')
      .select('created_at, sent_at')
      .eq('workspace_id', wsId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const lastAt = lastMsg?.sent_at || lastMsg?.created_at || null;

    const { error: upErr } = await supabase
      .from('workspace_channels')
      .update({
        messages_24h: count ?? 0,
        ...(lastAt ? { last_message_at: lastAt } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq('id', chId);

    if (!upErr) updated += 1;
  }

  return { updated };
}

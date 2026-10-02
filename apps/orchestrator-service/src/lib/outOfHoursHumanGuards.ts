import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Bloqueia auto-resposta OOH apenas quando houve handoff humano real.
 * Atribuição automática pelo bot (attendant_id) não suprime — setor pode estar fechado.
 */
export async function shouldSuppressOutOfHoursForConversation(
  db: SupabaseClient,
  conversationId: string
): Promise<boolean> {
  const { data: conv } = await db
    .from('conversations')
    .select('human_handoff_at, tags')
    .eq('id', conversationId)
    .maybeSingle();

  if (!conv) return false;

  if (conv.human_handoff_at) return true;

  const tags = ((conv.tags || []) as string[]).filter(Boolean);
  if (tags.includes('human_handoff')) return true;

  return false;
}

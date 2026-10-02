import type { SupabaseClient } from '@supabase/supabase-js';

/** Encerra tickets abertos vinculados à conversa ao resolver/encerrar atendimento. */
export async function closeOpenTicketsForConversation(
  client: SupabaseClient,
  workspaceId: string,
  conversationId: string
): Promise<number> {
  const now = new Date().toISOString();
  const { data: openTickets, error } = await client
    .from('tickets')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('conversation_id', conversationId)
    .in('status', ['open', 'in_progress', 'overdue']);

  if (error || !openTickets?.length) return 0;

  const ids = openTickets.map((t: { id: string }) => t.id).filter(Boolean);
  if (!ids.length) return 0;

  await client
    .from('tickets')
    .update({ status: 'resolved', resolved_at: now, updated_at: now })
    .in('id', ids);

  const events = ids.map((ticketId) => ({
    workspace_id: workspaceId,
    ticket_id: ticketId,
    event_type: 'ticket_closed_on_conversation_resolve',
    payload: { conversation_id: conversationId, source: 'conversation_resolve' },
    created_by: null,
  }));
  await client.from('ticket_events').insert(events);

  return ids.length;
}

export function scheduleCloseOpenTicketsForConversation(
  client: SupabaseClient,
  workspaceId: string,
  conversationId: string
): void {
  void closeOpenTicketsForConversation(client, workspaceId, conversationId).catch((err) =>
    console.error('[close-tickets-on-resolve]', conversationId, err)
  );
}

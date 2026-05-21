import type { SupabaseClient } from '@supabase/supabase-js';
import type { TicketClassification } from './mappings';

type CtxInput = {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  inboundText: string;
  classification: TicketClassification;
};

export async function buildContextSnapshot(db: SupabaseClient, input: CtxInput): Promise<Record<string, unknown>> {
  const { data: conversation } = await db
    .from('conversations')
    .select('id, sector_id, context_driver_id, context_leader_id, context_pharmacy_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.conversationId)
    .maybeSingle();

  const { data: contact } = await db
    .from('contacts')
    .select('id, wa_phone, display_name, profile_type')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.contactId)
    .maybeSingle();

  return {
    captured_at: new Date().toISOString(),
    classification: input.classification,
    conversation: conversation || null,
    contact: contact || null,
    message_excerpt: String(input.inboundText || '').slice(0, 280),
    financial_snapshot: {
      source: 'placeholder-v1',
      note: 'Snapshot financeiro completo sera integrado ao modulo financeiro.',
    },
  };
}

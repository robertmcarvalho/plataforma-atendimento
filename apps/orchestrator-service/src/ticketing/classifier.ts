import { randomUUID } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { findPendingCsatDispatch, parseCsatScore, parseCsatScoreFromMessage } from '@plataforma/channel-runtime';
import { classifyInboundText } from './mappings';
import { buildContextSnapshot } from './contextSnapshot';
import { computeDueAt } from './sla';

type InboundTicketInput = {
  workspaceId: string;
  conversationId: string;
  contactId: string;
  inboundText: string;
  messageId?: string | null;
  msg?: Record<string, unknown>;
};

export async function processInboundTicketing(db: SupabaseClient, input: InboundTicketInput): Promise<void> {
  const csatScore = input.msg
    ? parseCsatScoreFromMessage(input.msg)
    : parseCsatScore({ text: input.inboundText });
  if (csatScore !== null) return;

  const pendingCsat = await findPendingCsatDispatch(db, input.workspaceId, input.contactId);
  if (pendingCsat) return;

  const classification = classifyInboundText(input.inboundText);

  // Duvidas financeiras simples devem seguir pelo bot sem abrir ticket humano.
  if (classification.priority === 'bot' && classification.type === 'question') {
    return;
  }

  const { data: existingOpen } = await db
    .from('tickets')
    .select('id')
    .eq('workspace_id', input.workspaceId)
    .eq('conversation_id', input.conversationId)
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();

  if (existingOpen?.id) return;

  const { data: conversation } = await db
    .from('conversations')
    .select('context_driver_id, context_leader_id, context_pharmacy_id')
    .eq('workspace_id', input.workspaceId)
    .eq('id', input.conversationId)
    .maybeSingle();

  const persona =
    conversation?.context_driver_id ? 'driver' : conversation?.context_leader_id ? 'leader' : 'pharmacy';

  const contextSnap = await buildContextSnapshot(db, {
    workspaceId: input.workspaceId,
    conversationId: input.conversationId,
    contactId: input.contactId,
    inboundText: input.inboundText,
    classification,
  });

  const { data: ticket, error } = await db
    .from('tickets')
    .insert({
      workspace_id: input.workspaceId,
      ticket_code: buildTicketCode(),
      conversation_id: input.conversationId,
      persona,
      type: classification.type,
      priority: classification.priority,
      sla_minutes: classification.sla_minutes,
      channel_origin: 'whatsapp',
      driver_id: conversation?.context_driver_id || null,
      leader_id: conversation?.context_leader_id || null,
      pharmacy_id: conversation?.context_pharmacy_id || null,
      due_at: computeDueAt(classification),
      context_snap: contextSnap,
      classifier_version: 'v1-keyword',
    })
    .select('id')
    .single();

  if (error || !ticket?.id) {
    console.error('[Orchestrator] Falha ao abrir ticket automatico:', error?.message || 'insert retornou vazio');
    return;
  }

  await db.from('ticket_events').insert({
    workspace_id: input.workspaceId,
    ticket_id: ticket.id,
    event_type: 'ticket_opened',
    payload: {
      classification,
      message_id: input.messageId || null,
      source: 'orchestrator_inbound',
    },
    created_by: null,
  });
}

function buildTicketCode(): string {
  const seed = Date.now().toString(36).toUpperCase();
  const suffix = randomUUID().slice(0, 6).toUpperCase();
  return `TKT-${seed}-${suffix}`;
}

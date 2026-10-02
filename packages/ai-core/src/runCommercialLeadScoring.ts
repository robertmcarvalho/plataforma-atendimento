import type { SupabaseClient } from '@supabase/supabase-js';
import { isAiAnalysisEnabled, predictCommercialLeadScore } from './aiAnalyzer';
import { loadAiFeaturesConfig } from './aiFeaturesConfig';
import { resolveGeminiApiKey } from './geminiClient';

export type CommercialLeadScoringReason =
  | 'lead_created'
  | 'lead_updated'
  | 'message_received'
  | 'cron_stale'
  | 'manual_refresh';

export type RunCommercialLeadScoringArgs = {
  workspaceId: string;
  leadId: string;
  reason: CommercialLeadScoringReason;
  force?: boolean;
};

const DEBOUNCE_MS = 5 * 60 * 1000;
const MESSAGE_COOLDOWN_MS = 2 * 60 * 1000;

function cleanContent(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

function shouldSkipScoring(
  aiScoreSetAt: string | null | undefined,
  reason: CommercialLeadScoringReason,
  force?: boolean,
): boolean {
  if (force) return false;
  if (!aiScoreSetAt) return false;
  const elapsed = Date.now() - new Date(aiScoreSetAt).getTime();
  if (reason === 'message_received') return elapsed < MESSAGE_COOLDOWN_MS;
  if (reason === 'manual_refresh') return false;
  return elapsed < DEBOUNCE_MS;
}

async function resolveLeadConversationId(
  client: SupabaseClient,
  workspaceId: string,
  leadId: string,
  primaryConversationId: string | null | undefined,
): Promise<string | null> {
  if (primaryConversationId) return primaryConversationId;
  const { data: conv } = await client
    .from('conversations')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('context_commercial_lead_id', leadId)
    .neq('status', 'closed')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return conv?.id ? String(conv.id) : null;
}

async function buildCommercialLeadContext(
  client: SupabaseClient,
  workspaceId: string,
  lead: Record<string, unknown>,
  leadId: string,
): Promise<{ contextText: string; lastMessageAt: string | null }> {
  const stage = lead.stage as { name?: string; is_won?: boolean; is_lost?: boolean } | null;
  const chunks: string[] = [
    '=== FICHA DO LEAD ===',
    `Nome fantasia: ${lead.trade_name || '—'}`,
    `Razao social: ${lead.legal_name || '—'}`,
    `Cidade/UF: ${lead.city || '—'}/${lead.state || '—'}`,
    `Telefone: ${lead.phone || '—'}`,
    `Contato: ${lead.contact_name || '—'}`,
    `Origem: ${lead.source || '—'}`,
    `Campanha: ${lead.campaign || '—'}`,
    `Estagio: ${stage?.name || '—'}`,
    `Entregas/mes: ${lead.monthly_deliveries ?? '—'}`,
    `Entregadores: ${lead.drivers_count ?? '—'}`,
    `ERP: ${lead.erp || '—'}`,
    `Tags: ${Array.isArray(lead.tags) ? lead.tags.join(', ') : '—'}`,
    `Notas: ${lead.notes || '—'}`,
    `Valor deal (centavos): ${lead.deal_value_cents ?? '—'}`,
    `Previsao fechamento: ${lead.expected_close_at || '—'}`,
  ];

  const { data: activities } = await client
    .from('commercial_lead_activities')
    .select('activity_type, title, detail, created_at')
    .eq('workspace_id', workspaceId)
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false })
    .limit(30);

  if (activities?.length) {
    chunks.push('\n=== ATIVIDADES RECENTES ===');
    for (const row of [...activities].reverse()) {
      const title = cleanContent((row as { title?: string }).title);
      const detail = cleanContent((row as { detail?: string }).detail);
      const at = (row as { created_at?: string }).created_at || '';
      chunks.push(`[${at}] ${title}${detail ? ` — ${detail}` : ''}`);
    }
  }

  const conversationId = await resolveLeadConversationId(
    client,
    workspaceId,
    leadId,
    lead.primary_conversation_id as string | null | undefined,
  );

  let lastMessageAt: string | null = null;
  if (conversationId) {
    const { data: messages } = await client
      .from('messages')
      .select('direction, content, sent_at, created_at')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: true })
      .limit(40);

    if (messages?.length) {
      chunks.push('\n=== CONVERSA WHATSAPP ===');
      for (const msg of messages) {
        const content = cleanContent((msg as { content?: string }).content);
        if (!content) continue;
        const dir = (msg as { direction?: string }).direction === 'inbound' ? 'Lead' : 'Consultor';
        const at = String((msg as { sent_at?: string }).sent_at || (msg as { created_at?: string }).created_at || '');
        if (at && (!lastMessageAt || at > lastMessageAt)) lastMessageAt = at;
        chunks.push(`${dir}: ${content}`);
      }
    }
  }

  return { contextText: chunks.join('\n').trim(), lastMessageAt };
}

async function appendLeadActivity(
  client: SupabaseClient,
  args: {
    workspaceId: string;
    leadId: string;
    title: string;
    metadata?: Record<string, unknown>;
  },
) {
  await client.from('commercial_lead_activities').insert({
    workspace_id: args.workspaceId,
    lead_id: args.leadId,
    activity_type: 'ai_scoring',
    title: args.title,
    detail: null,
    metadata: args.metadata ?? {},
    created_by: null,
  });
}

export async function runCommercialLeadScoring(
  client: SupabaseClient,
  args: RunCommercialLeadScoringArgs,
): Promise<void> {
  if (!isAiAnalysisEnabled()) return;

  const flags = await loadAiFeaturesConfig(client, args.workspaceId);
  if (!flags.commercial_lead_scoring) {
    console.warn('[commercial-lead-scoring] feature desligada no workspace', args.workspaceId);
    return;
  }

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) {
    console.warn('[commercial-lead-scoring] Gemini não configurado; lead', args.leadId);
    return;
  }

  const { data: lead, error } = await client
    .from('commercial_leads')
    .select(
      '*, stage:commercial_pipeline_stages!stage_id(name, is_won, is_lost), primary_conversation_id, ai_score_set_at',
    )
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.leadId)
    .maybeSingle();
  if (error || !lead) return;

  const stage = lead.stage as { is_won?: boolean; is_lost?: boolean } | null;
  if (stage?.is_won || stage?.is_lost) return;

  if (shouldSkipScoring(lead.ai_score_set_at as string | null | undefined, args.reason, args.force)) {
    return;
  }

  const { contextText, lastMessageAt } = await buildCommercialLeadContext(
    client,
    args.workspaceId,
    lead as Record<string, unknown>,
    args.leadId,
  );
  if (!contextText) return;

  try {
    const result = await predictCommercialLeadScore(contextText, apiKey);
    const now = new Date().toISOString();
    const update: Record<string, unknown> = {
      ai_score: result.score,
      lead_temperature: result.temperature,
      ai_score_explanation: result.explanation,
      ai_score_set_at: now,
      ai_score_reason: args.reason,
      updated_at: now,
    };
    if (lastMessageAt) update.last_message_at = lastMessageAt;

    await client
      .from('commercial_leads')
      .update(update)
      .eq('workspace_id', args.workspaceId)
      .eq('id', args.leadId);

    await appendLeadActivity(client, {
      workspaceId: args.workspaceId,
      leadId: args.leadId,
      title: `Score IA: ${result.score} (${result.temperature})`,
      metadata: {
        score: result.score,
        temperature: result.temperature,
        reason: args.reason,
        signals: result.signals ?? [],
      },
    });
  } catch (e) {
    console.error('[commercial-lead-scoring]', args.leadId, args.reason, e);
  }
}

export function scheduleCommercialLeadScoring(
  client: SupabaseClient,
  args: RunCommercialLeadScoringArgs,
): void {
  void runCommercialLeadScoring(client, args).catch((err) =>
    console.error('[commercial-lead-scoring-schedule]', args.leadId, err),
  );
}

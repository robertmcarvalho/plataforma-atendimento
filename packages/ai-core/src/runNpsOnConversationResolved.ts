import type { SupabaseClient } from '@supabase/supabase-js';
import { isAiAnalysisEnabled, predictNps } from './aiAnalyzer';
import { loadAiFeaturesConfig } from './aiFeaturesConfig';
import { resolveGeminiApiKey } from './geminiClient';

function cleanContent(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

async function buildNpsTranscript(client: SupabaseClient, conversationId: string, summaryFallback: string | null): Promise<string> {
  const chunks: string[] = [];
  if (summaryFallback) chunks.push(`Resumo: ${summaryFallback}`);

  const { data: rows } = await client
    .from('messages')
    .select('direction, content')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true })
    .limit(80);

  for (const r of rows || []) {
    const c = cleanContent((r as { content?: unknown }).content);
    if (!c) continue;
    const dir = (r as { direction?: string }).direction === 'inbound' ? 'Cliente' : 'Atendimento';
    chunks.push(`${dir}: ${c}`);
  }

  return chunks.join('\n').trim();
}

/**
 * Ao resolver/fechar conversa: NPS preditivo (uma chamada Gemini), idempotente se `ai_nps_predicted` ja existir.
 */
export async function runNpsPredictionOnConversationResolved(
  client: SupabaseClient,
  conversationId: string,
  workspaceId?: string | null
): Promise<void> {
  if (!isAiAnalysisEnabled()) return;

  const flags = await loadAiFeaturesConfig(client, workspaceId);
  if (!flags.nps_predicted) return;

  const apiKey = resolveGeminiApiKey();
  if (!apiKey) return;

  const { data: conv, error } = await client
    .from('conversations')
    .select('id, summary, ai_nps_predicted, ai_nps_set_at')
    .eq('id', conversationId)
    .maybeSingle();
  if (error || !conv) return;

  if (conv.ai_nps_predicted != null || conv.ai_nps_set_at) return;

  const transcript = await buildNpsTranscript(client, conversationId, conv.summary ? String(conv.summary) : null);
  if (!transcript) return;

  try {
    const { score } = await predictNps(transcript, apiKey);
    const now = new Date().toISOString();
    await client
      .from('conversations')
      .update({ ai_nps_predicted: score, ai_nps_set_at: now, updated_at: now })
      .eq('id', conversationId);
  } catch (e) {
    console.error('[ai-nps]', conversationId, e);
  }
}

export function scheduleNpsPredictionOnResolved(client: SupabaseClient, conversationId: string, workspaceId?: string | null): void {
  void runNpsPredictionOnConversationResolved(client, conversationId, workspaceId).catch((err) =>
    console.error('[ai-nps-schedule]', conversationId, err)
  );
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { analyzeSentimentUrgency, isAiAnalysisEnabled } from './aiAnalyzer';
import { loadAiFeaturesConfig } from './aiFeaturesConfig';
import { findOrCreateTopic, formatVectorParam } from './aiTopics';
import { geminiEmbedContent, resolveGeminiApiKey } from './geminiClient';

const VECTOR_DIM = 768;

function toVector768(values: number[]): number[] {
  if (values.length === VECTOR_DIM) return values;
  if (values.length > VECTOR_DIM) return values.slice(0, VECTOR_DIM);
  const out = [...values];
  while (out.length < VECTOR_DIM) out.push(0);
  return out;
}

function cleanText(raw: unknown): string {
  return String(raw ?? '').replace(/\s+/g, ' ').trim();
}

export type InboundAiReason = 'first_message' | 'reopened' | 'transferred';

export type RunInboundAiAnalysisArgs = {
  conversationId: string;
  messageId?: string | null;
  inboundText?: string | null;
  tenantId?: string | null;
  reason: InboundAiReason;
};

async function fetchLastInbound(
  client: SupabaseClient,
  conversationId: string
): Promise<{ id: string; content: string } | null> {
  const { data, error } = await client
    .from('messages')
    .select('id, content')
    .eq('conversation_id', conversationId)
    .eq('direction', 'inbound')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data?.id) return null;
  const content = cleanText(data.content);
  if (!content) return null;
  return { id: data.id as string, content };
}

/**
 * Persistencia de sentimento, urgencia e topico (embedding) para 1ª mensagem, reabertura ou transferencia.
 * Chamadas Gemini respeitam `AI_ANALYSIS_ENABLED` e `ai_features_config` em `app_settings`.
 */
export async function runInboundAiAnalysis(client: SupabaseClient, args: RunInboundAiAnalysisArgs): Promise<void> {
  if (!isAiAnalysisEnabled()) return;

  let text = cleanText(args.inboundText ?? '');
  let targetMessageId = args.messageId ?? null;

  if (!text || !targetMessageId) {
    const last = await fetchLastInbound(client, args.conversationId);
    if (!last) return;
    if (!text) text = last.content;
    if (!targetMessageId) targetMessageId = last.id;
  }

  if (!text) return;

  const flags = await loadAiFeaturesConfig(client, args.tenantId);
  const needLlmInsight = flags.sentiment || flags.urgency;
  const needAnyGemini = needLlmInsight || flags.topic_clustering;
  const apiKey = resolveGeminiApiKey();

  if (needAnyGemini && !apiKey) {
    console.warn('[ai-inbound] recurso IA requer Gemini; defina GOOGLE_API_KEY ou GEMINI_API_KEY.', args.conversationId);
    return;
  }

  let analysis: Awaited<ReturnType<typeof analyzeSentimentUrgency>> | null = null;
  if (needLlmInsight && apiKey) {
    try {
      analysis = await analyzeSentimentUrgency(text, apiKey);
    } catch (e) {
      console.error('[ai-inbound] analyzeSentimentUrgency', args.conversationId, e);
    }
  }

  const now = new Date().toISOString();

  if (analysis && targetMessageId) {
    await client
      .from('messages')
      .update({
        ai_sentiment: flags.sentiment ? analysis.sentiment : null,
        ai_sentiment_score: flags.sentiment ? analysis.sentimentScore : null,
        ai_urgency: flags.urgency ? analysis.urgency : null,
        ai_urgency_score: flags.urgency ? analysis.urgencyScore : null,
        ai_analyzed_at: now,
      })
      .eq('id', targetMessageId);
  }

  const convPatch: Record<string, unknown> = { updated_at: now };

  if (analysis) {
    if (flags.sentiment) convPatch.ai_sentiment_last = analysis.sentiment;
    if (flags.urgency) convPatch.ai_urgency_score = analysis.urgencyScore;
  }

  if (flags.topic_clustering && apiKey) {
    try {
      const rawEmb = await geminiEmbedContent({ apiKey, text });
      const emb = toVector768(rawEmb);
      const vecStr = formatVectorParam(emb);
      const topic = await findOrCreateTopic(client, {
        apiKey,
        embedding: emb,
        sampleText: text.slice(0, 2000),
        tenantId: args.tenantId ?? null,
      });
      convPatch.ai_topic_id = topic.id;
      convPatch.ai_topic_embedding = vecStr;
      convPatch.ai_topic_set_at = now;
    } catch (e) {
      console.error('[ai-inbound] topic/embedding', args.conversationId, e);
    }
  }

  if (Object.keys(convPatch).length > 1) {
    await client.from('conversations').update(convPatch).eq('id', args.conversationId);
  }
}

/** Dispara pipeline sem bloquear (Pub/Sub / HTTP). Erros apenas em log. */
export function scheduleInboundAiAnalysis(client: SupabaseClient, args: RunInboundAiAnalysisArgs): void {
  void runInboundAiAnalysis(client, args).catch((err) =>
    console.error('[ai-inbound]', args.reason, args.conversationId, err)
  );
}

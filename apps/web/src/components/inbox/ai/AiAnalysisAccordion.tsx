'use client';

import type { AiFeaturesState } from '@/lib/ai/defaults';

type InboundAi = {
  ai_sentiment?: string | null;
  ai_sentiment_score?: number | null;
  ai_urgency?: string | null;
  ai_urgency_score?: number | null;
  ai_analyzed_at?: string | null;
};

type DetailShape = {
  ai_sentiment_last?: string | null;
  ai_urgency_score?: number | null;
  ai_nps_predicted?: number | null;
  ai_nps_set_at?: string | null;
  topic?: { id?: string; name?: string } | null;
  messages?: InboundAi[] | null;
};

function lastInboundWithAi(messages: InboundAi[] | null | undefined): InboundAi | null {
  if (!messages?.length) return null;
  const inbound = messages.filter((m) => (m as { direction?: string }).direction === 'inbound') as Array<
    InboundAi & { direction?: string; created_at?: string }
  >;
  if (!inbound.length) return null;
  return inbound.reduce((a, b) => {
    const ta = new Date(a.created_at || 0).getTime();
    const tb = new Date(b.created_at || 0).getTime();
    return tb >= ta ? b : a;
  });
}

export function AiAnalysisAccordion({
  detail,
  flags,
}: {
  detail: unknown;
  flags: AiFeaturesState;
}) {
  const d = detail as DetailShape | null;
  if (!d) return null;

  const lastIn = lastInboundWithAi(d.messages as InboundAi[] | undefined);
  const sentiment = flags.sentiment ? d.ai_sentiment_last || lastIn?.ai_sentiment : null;
  const urgency = flags.urgency ? lastIn?.ai_urgency : null;
  const urgencyScore = flags.urgency ? lastIn?.ai_urgency_score : null;
  const topicName = flags.topic_clustering ? d.topic?.name : null;
  const nps = flags.nps_predicted ? d.ai_nps_predicted : null;

  const hasAny =
    (sentiment != null && sentiment !== '') ||
    (urgency != null && urgency !== '') ||
    (topicName != null && topicName !== '') ||
    (nps != null && nps !== undefined);

  if (!hasAny) return null;

  return (
    <details className="inbox-context-accordion">
      <summary className="inbox-context-accordion-summary">
        <span className="inbox-context-title" style={{ marginBottom: 0 }}>
          Insights de IA
        </span>
        <span className="inbox-context-chevron">+</span>
      </summary>
      <div className="space-y-2 text-xs text-muted-foreground">
        {flags.sentiment && sentiment ? (
          <div>
            <span className="font-medium text-foreground/90">Sentimento (última análise):</span>{' '}
            <span className="capitalize">{sentiment}</span>
            {lastIn?.ai_sentiment_score != null ? (
              <span className="ml-1 font-mono text-[10px] text-subtle-foreground">
                ({Math.round(Number(lastIn.ai_sentiment_score) * 100)}% conf.)
              </span>
            ) : null}
          </div>
        ) : null}
        {flags.urgency && urgency ? (
          <div>
            <span className="font-medium text-foreground/90">Urgência:</span>{' '}
            <span className="capitalize">{urgency}</span>
            {urgencyScore != null ? (
              <span className="ml-1 font-mono text-[10px] text-subtle-foreground">
                ({Math.round(Number(urgencyScore) * 100)}% conf.)
              </span>
            ) : null}
          </div>
        ) : null}
        {flags.topic_clustering && topicName ? (
          <div>
            <span className="font-medium text-foreground/90">Tópico:</span> {topicName}
          </div>
        ) : null}
        {flags.nps_predicted && nps != null ? (
          <div>
            <span className="font-medium text-foreground/90">NPS previsto:</span>{' '}
            <span className="font-mono font-semibold text-foreground">{nps}</span>/10
          </div>
        ) : null}
      </div>
    </details>
  );
}

type RecentMessage = {
  direction?: string;
  ai_sentiment?: string | null;
  ai_urgency?: string | null;
  ai_urgency_score?: number | null;
  created_at?: string;
};

type ConversationAi = {
  ai_sentiment_last?: string | null;
  ai_urgency_score?: number | null;
  demand_key?: string | null;
  sla?: {
    treatment_deadline?: string | null;
    first_response_deadline?: string | null;
  };
};

export type CopilotSignal = {
  label: string;
  value: string;
  tone: 'default' | 'primary' | 'warning' | 'danger';
};

function sentimentLabelPt(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).toLowerCase();
  if (s === 'positivo') return 'Positivo';
  if (s === 'negativo') return 'Negativo';
  if (s === 'neutro') return 'Neutro';
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

function formatSentimentValue(conv: ConversationAi, messages: RecentMessage[]): string | null {
  const inbound = messages.filter((m) => m.direction === 'inbound');
  const withSentiment = inbound.filter((m) => m.ai_sentiment);
  const last = withSentiment.at(-1)?.ai_sentiment ?? conv.ai_sentiment_last;
  const prev = withSentiment.length >= 2 ? withSentiment.at(-2)?.ai_sentiment : null;
  const lastPt = sentimentLabelPt(last);
  if (!lastPt) return null;
  const prevPt = sentimentLabelPt(prev);
  if (prevPt && prevPt !== lastPt) return `${prevPt} → ${lastPt}`;
  return lastPt;
}

function formatUrgencyValue(conv: ConversationAi, messages: RecentMessage[]): string | null {
  const inbound = messages.filter((m) => m.direction === 'inbound');
  const lastUrgent = [...inbound].reverse().find((m) => m.ai_urgency || m.ai_urgency_score != null);
  const score =
    lastUrgent?.ai_urgency_score != null
      ? Number(lastUrgent.ai_urgency_score)
      : conv.ai_urgency_score != null
        ? Number(conv.ai_urgency_score)
        : null;

  const deadline = conv.sla?.treatment_deadline || conv.sla?.first_response_deadline;
  if (deadline) {
    const ms = new Date(deadline).getTime() - Date.now();
    if (!Number.isNaN(ms)) {
      const mins = Math.round(ms / 60000);
      if (mins <= 0) return 'SLA vencido';
      if (mins < 60) return `SLA ${mins} min`;
      const h = Math.floor(mins / 60);
      return `SLA ${h}h`;
    }
  }

  if (score != null && !Number.isNaN(score)) {
    if (score >= 0.75) return 'Alta';
    if (score >= 0.45) return 'Média';
    return 'Baixa';
  }

  const urg = lastUrgent?.ai_urgency;
  if (urg) {
    const u = String(urg).toLowerCase();
    if (u === 'high' || u === 'alta') return 'Alta';
    if (u === 'medium' || u === 'media' || u === 'média') return 'Média';
    if (u === 'low' || u === 'baixa') return 'Baixa';
  }
  return null;
}

function formatIntentValue(demandTitle: string | null | undefined): string | null {
  const t = String(demandTitle || '').trim();
  return t.length ? t : null;
}

/** Heurística leve até modelo dedicado de churn. */
function formatChurnValue(messages: RecentMessage[]): string | null {
  const inbound = messages.filter((m) => m.direction === 'inbound');
  const negatives = inbound.filter((m) => String(m.ai_sentiment || '').toLowerCase() === 'negativo').length;
  if (negatives >= 2) return 'Risco moderado';
  if (negatives === 1 && inbound.length <= 3) return 'Atenção';
  return null;
}

export function buildCopilotInsightSignals(input: {
  conversation: ConversationAi;
  recentMessages: RecentMessage[];
  demandTitle?: string | null;
}): CopilotSignal[] {
  const { conversation, recentMessages, demandTitle } = input;
  const signals: CopilotSignal[] = [];

  const sentiment = formatSentimentValue(conversation, recentMessages);
  if (sentiment) signals.push({ label: 'Sentimento', value: sentiment, tone: sentiment.includes('Negativo') ? 'danger' : 'warning' });

  const urgency = formatUrgencyValue(conversation, recentMessages);
  if (urgency) {
    signals.push({
      label: 'Urgência',
      value: urgency,
      tone: urgency.includes('vencido') || urgency === 'Alta' ? 'danger' : 'warning',
    });
  }

  const intent = formatIntentValue(demandTitle);
  if (intent) signals.push({ label: 'Intenção', value: intent, tone: 'primary' });

  const churn = formatChurnValue(recentMessages);
  if (churn) signals.push({ label: 'Churn', value: churn, tone: 'warning' });

  return signals;
}

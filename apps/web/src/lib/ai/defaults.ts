export type AiFeaturesState = {
  sentiment: boolean;
  urgency: boolean;
  suggest_reply: boolean;
  inbound_assist: boolean;
  nps_predicted: boolean;
  topic_clustering: boolean;
};

/** Alinhado ao default do backend `@plataforma/ai-core`. */
export const DEFAULT_AI_FEATURES: AiFeaturesState = {
  sentiment: true,
  urgency: true,
  suggest_reply: true,
  inbound_assist: true,
  nps_predicted: true,
  topic_clustering: true,
};

export function parseAiFeaturesConfig(raw: unknown): Partial<AiFeaturesState> {
  if (raw == null) return {};
  let obj: unknown = raw;
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw) as unknown;
    } catch {
      return {};
    }
  }
  if (typeof obj !== 'object' || obj === null) return {};
  const o = obj as Record<string, unknown>;
  const out: Partial<AiFeaturesState> = {};
  if (typeof o.sentiment === 'boolean') out.sentiment = o.sentiment;
  if (typeof o.urgency === 'boolean') out.urgency = o.urgency;
  if (typeof o.suggest_reply === 'boolean') out.suggest_reply = o.suggest_reply;
  if (typeof o.inbound_assist === 'boolean') out.inbound_assist = o.inbound_assist;
  if (typeof o.nps_predicted === 'boolean') out.nps_predicted = o.nps_predicted;
  if (typeof o.topic_clustering === 'boolean') out.topic_clustering = o.topic_clustering;
  return out;
}

export function mergeAiFeatures(raw: unknown): AiFeaturesState {
  return { ...DEFAULT_AI_FEATURES, ...parseAiFeaturesConfig(raw) };
}

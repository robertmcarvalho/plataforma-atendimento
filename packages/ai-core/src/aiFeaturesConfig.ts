import type { SupabaseClient } from '@supabase/supabase-js';

/** Flags por capacidade (`app_settings.ai_features_config`). Defaults: tudo ligado. */
export type AiFeaturesConfig = {
  sentiment: boolean;
  urgency: boolean;
  suggest_reply: boolean;
  /** Rascunho + próximos passos ao receber inbound (API + inbox). Requer `suggest_reply` ligado na prática. */
  inbound_assist: boolean;
  nps_predicted: boolean;
  topic_clustering: boolean;
};

export const DEFAULT_AI_FEATURES: AiFeaturesConfig = {
  sentiment: true,
  urgency: true,
  suggest_reply: true,
  inbound_assist: true,
  nps_predicted: true,
  topic_clustering: true,
};

function parseStoredValue(raw: unknown): Partial<AiFeaturesConfig> {
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
  const out: Partial<AiFeaturesConfig> = {};
  if (typeof o.sentiment === 'boolean') out.sentiment = o.sentiment;
  if (typeof o.urgency === 'boolean') out.urgency = o.urgency;
  if (typeof o.suggest_reply === 'boolean') out.suggest_reply = o.suggest_reply;
  if (typeof o.inbound_assist === 'boolean') out.inbound_assist = o.inbound_assist;
  if (typeof o.nps_predicted === 'boolean') out.nps_predicted = o.nps_predicted;
  if (typeof o.topic_clustering === 'boolean') out.topic_clustering = o.topic_clustering;
  return out;
}

export async function loadAiFeaturesConfig(client: SupabaseClient, workspaceId?: string | null): Promise<AiFeaturesConfig> {
  const scopedWorkspaceId = String(workspaceId || '').trim();
  if (scopedWorkspaceId) {
    const { data } = await client
      .from('app_settings')
      .select('value')
      .eq('workspace_id', scopedWorkspaceId)
      .eq('key', 'ai_features_config')
      .maybeSingle();
    if (data?.value != null) {
      return { ...DEFAULT_AI_FEATURES, ...parseStoredValue(data.value) };
    }
  }

  const { data } = await client
    .from('app_settings')
    .select('value')
    .is('workspace_id', null)
    .eq('key', 'ai_features_config')
    .maybeSingle();
  const partial = parseStoredValue(data?.value ?? null);
  return { ...DEFAULT_AI_FEATURES, ...partial };
}

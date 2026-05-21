import type { SupabaseClient } from '@supabase/supabase-js';
import { nameTopicFromExamples, resolveAiMaxTopics, resolveAiTopicThreshold } from './aiAnalyzer';

/** Formato aceito pelo PostgREST / pgvector para colunas e parametros `vector`. */
export function formatVectorParam(embedding: number[]): string {
  if (!embedding.length) {
    throw new Error('Embedding vazio');
  }
  return `[${embedding.join(',')}]`;
}

export type FindOrCreateTopicParams = {
  apiKey: string;
  embedding: number[];
  sampleText: string;
  tenantId?: string | null;
  threshold?: number;
};

export type FindOrCreateTopicResult = {
  id: string;
  name: string;
  /** `true` quando um novo registro em `ai_topics` foi criado */
  created: boolean;
};

type MatchRow = { id: string; name: string; similarity: number };

export async function findOrCreateTopic(
  client: SupabaseClient,
  params: FindOrCreateTopicParams
): Promise<FindOrCreateTopicResult> {
  const threshold = params.threshold ?? resolveAiTopicThreshold();
  const maxTopics = resolveAiMaxTopics();
  const tenantId = params.tenantId ?? null;
  const vecStr = formatVectorParam(params.embedding);

  const { data: matchRows, error: matchErr } = await client.rpc('match_ai_topic_by_embedding', {
    p_embedding: vecStr,
    p_tenant_id: tenantId,
    p_threshold: threshold,
  });

  if (matchErr) {
    throw new Error(`match_ai_topic_by_embedding: ${matchErr.message}`);
  }

  const best = Array.isArray(matchRows) && matchRows.length > 0 ? (matchRows[0] as MatchRow) : null;
  if (best?.id) {
    const { error: mergeErr } = await client.rpc('merge_ai_topic_centroid', {
      p_topic_id: best.id,
      p_embedding: vecStr,
    });
    if (mergeErr) {
      throw new Error(`merge_ai_topic_centroid: ${mergeErr.message}`);
    }
    return { id: best.id, name: best.name, created: false };
  }

  let query = client.from('ai_topics').select('id', { count: 'exact', head: true });
  if (tenantId === null) {
    query = query.is('tenant_id', null);
  } else {
    query = query.eq('tenant_id', tenantId);
  }
  const { count, error: countErr } = await query;
  if (countErr) {
    throw new Error(`ai_topics count: ${countErr.message}`);
  }

  const n = count ?? 0;

  if (n >= maxTopics) {
    const { data: nearRows, error: nearErr } = await client.rpc('nearest_ai_topic_by_embedding', {
      p_embedding: vecStr,
      p_tenant_id: tenantId,
    });
    if (nearErr) {
      throw new Error(`nearest_ai_topic_by_embedding: ${nearErr.message}`);
    }
    const near = Array.isArray(nearRows) && nearRows.length > 0 ? (nearRows[0] as MatchRow) : null;
    if (near?.id) {
      const { error: mergeErr } = await client.rpc('merge_ai_topic_centroid', {
        p_topic_id: near.id,
        p_embedding: vecStr,
      });
      if (mergeErr) {
        throw new Error(`merge_ai_topic_centroid: ${mergeErr.message}`);
      }
      return { id: near.id, name: near.name, created: false };
    }
  }

  const { name } = await nameTopicFromExamples([params.sampleText], params.apiKey);

  const { data: inserted, error: insErr } = await client
    .from('ai_topics')
    .insert({
      tenant_id: tenantId,
      name,
      centroid: vecStr,
      sample_count: 1,
    })
    .select('id,name')
    .single();

  if (insErr || !inserted) {
    throw new Error(`ai_topics insert: ${insErr?.message ?? 'sem linha'}`);
  }

  return { id: inserted.id as string, name: inserted.name as string, created: true };
}

import type { SupabaseClient } from '@supabase/supabase-js';
import { runCommercialLeadScoring } from '@plataforma/ai-core';

const BATCH_LIMIT = 50;

export function registerCommercialLeadScoringJobs(db: SupabaseClient, timezone: string) {
  return {
    runCommercialLeadScoringBatch: () => runCommercialLeadScoringBatch(db),
    timezone,
  };
}

async function runCommercialLeadScoringBatch(db: SupabaseClient) {
  const staleBefore = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: nullScores, error: nullErr } = await db
    .from('commercial_leads')
    .select('id, workspace_id, stage:commercial_pipeline_stages!stage_id(is_won, is_lost)')
    .is('ai_score_set_at', null)
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (nullErr) {
    console.error('[commercial-lead-scoring-cron]', nullErr.message);
    return { processed: 0 };
  }

  const { data: staleScores, error: staleErr } = await db
    .from('commercial_leads')
    .select('id, workspace_id, stage:commercial_pipeline_stages!stage_id(is_won, is_lost)')
    .lt('ai_score_set_at', staleBefore)
    .order('ai_score_set_at', { ascending: true })
    .limit(BATCH_LIMIT);

  if (staleErr) {
    console.error('[commercial-lead-scoring-cron]', staleErr.message);
  }

  const seen = new Set<string>();
  const leads = [...(nullScores || []), ...(staleScores || [])].filter((row) => {
    const id = String(row.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  }).slice(0, BATCH_LIMIT);

  let processed = 0;
  for (const row of leads || []) {
    const stage = row.stage as { is_won?: boolean; is_lost?: boolean } | null;
    if (stage?.is_won || stage?.is_lost) continue;
    await runCommercialLeadScoring(db, {
      workspaceId: String(row.workspace_id),
      leadId: String(row.id),
      reason: 'cron_stale',
    });
    processed += 1;
  }

  return { processed };
}

import { runCommercialLeadScoring, scheduleCommercialLeadScoring, type CommercialLeadScoringReason } from '@plataforma/ai-core';
import { supabase } from '../supabase';

export function triggerCommercialLeadScoring(args: {
  workspaceId: string;
  leadId: string;
  reason: CommercialLeadScoringReason;
  force?: boolean;
}): void {
  scheduleCommercialLeadScoring(supabase, args);
}

/** Aguarda o scoring (uso na API — Cloud Run não garante trabalho após o reply). */
export async function awaitCommercialLeadScoring(args: {
  workspaceId: string;
  leadId: string;
  reason: CommercialLeadScoringReason;
  force?: boolean;
}): Promise<void> {
  await runCommercialLeadScoring(supabase, args);
}

'use client';

import type { CommercialLead, CommercialStage } from '@/lib/commercial/types';
import { hasPersistedAiScore, isLeadScoringPending, isTerminalStage } from '@/lib/commercial/commercialScoring';
import { cn } from '@/lib/utils';

type Props = {
  lead: CommercialLead;
  stage?: CommercialStage;
  size?: 'sm' | 'md';
  className?: string;
};

export function CommercialAiScoreChip({ lead, stage, size = 'sm', className }: Props) {
  if (hasPersistedAiScore(lead)) {
    return (
      <span
        className={cn(
          'rounded-full bg-primary/10 font-semibold text-primary',
          size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
          className,
        )}
      >
        IA {lead.ai_score}
      </span>
    );
  }

  if (!isTerminalStage(stage) && isLeadScoringPending(lead)) {
    return (
      <span
        className={cn(
          'rounded-full bg-muted font-medium text-muted-foreground animate-pulse',
          size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
          className,
        )}
      >
        Calculando…
      </span>
    );
  }

  return null;
}

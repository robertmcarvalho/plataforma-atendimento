'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { listStagnantLeads, STAGNANT_STAGE_DAYS } from '@/lib/commercial/commercialScoring';
import type { CommercialLead, CommercialStage } from '@/lib/commercial/types';

type Props = {
  leads: CommercialLead[];
  stages: CommercialStage[];
  className?: string;
};

export function CommercialStagnantBanner({ leads, stages, className }: Props) {
  const stagnant = listStagnantLeads(leads, stages);
  if (stagnant.length === 0) return null;

  const preview = stagnant.slice(0, 3).map((l) => l.trade_name).join(', ');
  const more = stagnant.length > 3 ? ` +${stagnant.length - 3}` : '';

  return (
    <div
      className={`mb-4 flex flex-wrap items-start gap-3 rounded-lg border border-warning/40 bg-warning/10 px-4 py-3 text-sm ${className ?? ''}`}
      role="status"
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-foreground">
          {stagnant.length} negócio{stagnant.length > 1 ? 's' : ''} estagnado{stagnant.length > 1 ? 's' : ''} (
          {STAGNANT_STAGE_DAYS}+ dias no estágio)
        </p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {preview}
          {more}
        </p>
      </div>
      <Link
        href={`/commercial/leads?id=${stagnant[0]?.id}`}
        className="shrink-0 text-xs font-medium text-primary hover:underline"
      >
        Ver leads
      </Link>
    </div>
  );
}

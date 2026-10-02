'use client';

import { deriveLeadTemperature } from '@/lib/commercial/commercialScoring';
import { leadTemperatureLabel, leadTemperatureTone } from '@/lib/commercial/commercialFormat';
import type { CommercialLead, CommercialStage } from '@/lib/commercial/types';
import { cn } from '@/lib/utils';

type Props = {
  lead: CommercialLead;
  stage?: CommercialStage;
  className?: string;
  size?: 'sm' | 'md';
};

export function CommercialTemperatureBadge({ lead, stage, className, size = 'sm' }: Props) {
  const temp = deriveLeadTemperature(lead, stage);
  if (!temp) return null;
  const tone = leadTemperatureTone(temp);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full font-semibold uppercase tracking-wide',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
        tone,
        className,
      )}
      title={`Temperatura: ${leadTemperatureLabel(temp)}${lead.ai_score != null ? ` · Score ${lead.ai_score}` : ''}`}
    >
      {leadTemperatureLabel(temp)}
    </span>
  );
}

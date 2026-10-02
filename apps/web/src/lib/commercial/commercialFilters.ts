import { deriveLeadTemperature, deriveLeadTemperatureWithStages } from '@/lib/commercial/commercialScoring';
import type { CommercialLead, CommercialLeadSource, CommercialStage, LeadTemperature } from '@/lib/commercial/types';

export type CommercialLeadFilters = {
  ownerId?: string;
  source?: CommercialLeadSource | 'all';
  periodDays?: 7 | 30 | 90;
  search?: string;
  stageId?: string;
  tag?: string;
  temperature?: LeadTemperature | 'all';
};

export function isWithinPeriod(iso: string, periodDays: 7 | 30 | 90) {
  const cutoff = Date.now() - periodDays * 86400000;
  return new Date(iso).getTime() >= cutoff;
}

export function filterCommercialLeads(
  leads: CommercialLead[],
  filters: CommercialLeadFilters,
  stages?: CommercialStage[],
): CommercialLead[] {
  const q = filters.search?.trim().toLowerCase() ?? '';

  return leads.filter((lead) => {
    if (filters.ownerId && filters.ownerId !== 'all' && lead.owner_id !== filters.ownerId) return false;
    if (filters.source && filters.source !== 'all' && lead.source !== filters.source) return false;
    if (filters.stageId && filters.stageId !== 'all' && lead.stage_id !== filters.stageId) return false;
    if (filters.tag && filters.tag !== 'all' && !(lead.tags || []).includes(filters.tag)) return false;
    if (filters.temperature && filters.temperature !== 'all') {
      const temp = stages
        ? deriveLeadTemperatureWithStages(lead, stages)
        : deriveLeadTemperature(lead);
      if (temp !== filters.temperature) return false;
    }
    if (filters.periodDays && !isWithinPeriod(lead.created_at, filters.periodDays)) return false;
    if (!q) return true;
    return (
      (lead.trade_name ?? '').toLowerCase().includes(q) ||
      (lead.legal_name ?? '').toLowerCase().includes(q) ||
      (lead.contact_name ?? '').toLowerCase().includes(q) ||
      (lead.city ?? '').toLowerCase().includes(q) ||
      (lead.cnpj?.replace(/\D/g, '') || '').includes(q.replace(/\D/g, ''))
    );
  });
}

/** Buckets for time-series chart: created vs won in period */
export function buildPeriodChartSeries(
  leads: CommercialLead[],
  wonStageId: string | undefined,
  periodDays: 7 | 30 | 90,
) {
  const bucketCount = periodDays === 7 ? 7 : periodDays === 30 ? 4 : 3;
  const bucketMs = (periodDays * 86400000) / bucketCount;
  const now = Date.now();
  const start = now - periodDays * 86400000;

  return Array.from({ length: bucketCount }, (_, i) => {
    const bucketStart = start + i * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    const inBucket = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= bucketStart && t < bucketEnd;
    };
    const created = leads.filter((l) => inBucket(l.created_at)).length;
    const won = wonStageId
      ? leads.filter((l) => l.stage_id === wonStageId && inBucket(l.updated_at)).length
      : 0;
    return { label: `P${i + 1}`, created, won };
  });
}

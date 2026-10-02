import { filterCommercialLeads } from '@/lib/commercial/commercialFilters';
import {
  deriveLeadTemperature,
  deriveLeadTemperatureWithStages,
  isTerminalStage,
  listStagnantLeads,
  pipelineWeightedValueCents,
} from '@/lib/commercial/commercialScoring';
import { commercialSourceLabel } from '@/lib/commercial/commercialFormat';
import type {
  CommercialLead,
  CommercialLeadSource,
  CommercialStage,
  LeadTemperature,
} from '@/lib/commercial/types';

export type CommercialDashboardFilters = {
  ownerId?: string;
  source?: CommercialLeadSource | 'all';
  periodDays: 7 | 30 | 90;
  compare: boolean;
};

export type FunnelRow = {
  stageId: string;
  name: string;
  count: number;
  color: string;
  conversionPct: number | null;
};

export type PieRow = { name: string; value: number; color: string; key: string };

export type TimeSeriesRow = {
  label: string;
  created: number;
  won: number;
  lost: number;
};

export type TopDealRow = {
  id: string;
  trade_name: string;
  deal_value_cents: number;
  stageName: string;
  stageColor: string;
  temperature: LeadTemperature;
  owner_id: string;
};

export type OwnerPerfRow = {
  ownerId: string;
  name: string;
  pipelineCents: number;
  wonCount: number;
  openCount: number;
};

export type CommercialDashboardMetrics = {
  hero: {
    pipelineWeightedCents: number;
    closedWonCents: number;
    conversionPct: number;
    hotUrgentCount: number;
    pipelineSparkline: number[];
  };
  deltas: {
    created: number | null;
    won: number | null;
    conversion: number | null;
    hotUrgent: number | null;
    pipelineWeighted: number | null;
  } | null;
  secondary: {
    createdInPeriod: number;
    wonInPeriod: number;
    lostInPeriod: number;
    proposalsOpen: number;
    avgCycleDays: number | null;
    stagnantCount: number;
  };
  funnel: FunnelRow[];
  timeSeries: TimeSeriesRow[];
  bySource: PieRow[];
  byTemperature: PieRow[];
  ownerPerformance: OwnerPerfRow[];
  topDeals: TopDealRow[];
  attention: {
    hotUrgent: CommercialLead[];
    stagnant: CommercialLead[];
    followUpLate: CommercialLead[];
  };
};

const TEMPERATURE_COLORS: Record<LeadTemperature, string> = {
  frio: 'color-mix(in oklch, var(--muted-foreground) 50%, transparent)',
  morno: 'var(--chart-3)',
  quente: '#f97316',
  urgente: 'var(--destructive)',
};

const SOURCE_COLORS: Record<CommercialLeadSource, string> = {
  manual: 'var(--chart-4)',
  instagram: '#e1306c',
  indicacao: '#8b5cf6',
  whatsapp: 'hsl(var(--channel-whatsapp, 142 76% 36%))',
  campanha: '#0ea5e9',
  referral: '#a855f7',
  other: 'var(--chart-5)',
};

function applyScopeFilters(leads: CommercialLead[], filters: CommercialDashboardFilters) {
  return filterCommercialLeads(leads, {
    ownerId: filters.ownerId,
    source: filters.source,
  });
}

function createdBetween(lead: CommercialLead, start: number, end: number) {
  const t = new Date(lead.created_at).getTime();
  return t >= start && t < end;
}

function updatedBetween(lead: CommercialLead, start: number, end: number) {
  const t = new Date(lead.updated_at).getTime();
  return t >= start && t < end;
}

export function pctDelta(current: number, previous: number): number | null {
  if (previous === 0) return current > 0 ? 100 : current === 0 ? 0 : null;
  return Math.round(((current - previous) / previous) * 100);
}

export function formatDeltaLabel(delta: number | null, invertGood = false): string | null {
  if (delta === null) return null;
  const sign = delta > 0 ? '+' : '';
  const label = `${sign}${delta}% vs período anterior`;
  if (!invertGood) return label;
  return label;
}

export function deltaTone(delta: number | null, higherIsGood = true): 'success' | 'destructive' | 'muted' {
  if (delta === null || delta === 0) return 'muted';
  const good = higherIsGood ? delta > 0 : delta < 0;
  return good ? 'success' : 'destructive';
}

function buildTimeSeries(
  leads: CommercialLead[],
  wonStageId: string | undefined,
  lostStageId: string | undefined,
  periodDays: 7 | 30 | 90,
): TimeSeriesRow[] {
  const bucketCount = periodDays === 7 ? 7 : periodDays === 30 ? 4 : 3;
  const periodMs = periodDays * 86400000;
  const bucketMs = periodMs / bucketCount;
  const now = Date.now();
  const start = now - periodMs;

  return Array.from({ length: bucketCount }, (_, i) => {
    const bucketStart = start + i * bucketMs;
    const bucketEnd = bucketStart + bucketMs;
    const inBucket = (iso: string) => {
      const t = new Date(iso).getTime();
      return t >= bucketStart && t < bucketEnd;
    };
    const label =
      periodDays === 7
        ? new Date(bucketStart).toLocaleDateString('pt-BR', { weekday: 'short' })
        : new Date(bucketStart).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });

    return {
      label,
      created: leads.filter((l) => inBucket(l.created_at)).length,
      won: wonStageId ? leads.filter((l) => l.stage_id === wonStageId && inBucket(l.updated_at)).length : 0,
      lost: lostStageId ? leads.filter((l) => l.stage_id === lostStageId && inBucket(l.updated_at)).length : 0,
    };
  });
}

function followUpLateLeads(leads: CommercialLead[], stages: CommercialStage[]): CommercialLead[] {
  return leads.filter((lead) => {
    const stage = stages.find((s) => s.id === lead.stage_id);
    if (isTerminalStage(stage)) return false;
    if (!lead.last_message_at) {
      const days = (Date.now() - new Date(lead.created_at).getTime()) / 86400000;
      return days >= 3;
    }
    const hours = (Date.now() - new Date(lead.last_message_at).getTime()) / 3600000;
    return hours >= 72;
  });
}

export function buildCommercialDashboardMetrics(
  leads: CommercialLead[],
  stages: CommercialStage[],
  filters: CommercialDashboardFilters,
  ownerNames: Map<string, string>,
): CommercialDashboardMetrics {
  const scoped = applyScopeFilters(leads, filters);
  const now = Date.now();
  const periodMs = filters.periodDays * 86400000;
  const curStart = now - periodMs;
  const prevStart = now - 2 * periodMs;

  const periodCurrent = scoped.filter((l) => createdBetween(l, curStart, now));
  const periodPrevious = scoped.filter((l) => createdBetween(l, prevStart, curStart));

  const wonStage = stages.find((s) => s.is_won);
  const lostStage = stages.find((s) => s.is_lost);
  const proposalStageIds = new Set(
    stages.filter((s) => ['stage-proposal', 'stage-negotiation', 'stage-contract'].includes(s.id)).map((s) => s.id),
  );

  const openLeads = scoped.filter((l) => {
    const stage = stages.find((s) => s.id === l.stage_id);
    return stage && !isTerminalStage(stage);
  });

  const pipelineWeightedCents = pipelineWeightedValueCents(openLeads, stages);

  const wonInPeriod = scoped.filter(
    (l) => wonStage && l.stage_id === wonStage.id && updatedBetween(l, curStart, now),
  );
  const wonPrevPeriod = scoped.filter(
    (l) => wonStage && l.stage_id === wonStage.id && updatedBetween(l, prevStart, curStart),
  );

  const closedWonCents = wonInPeriod.reduce((s, l) => s + (l.deal_value_cents ?? 0), 0);

  const lostInPeriod = scoped.filter(
    (l) => lostStage && l.stage_id === lostStage.id && updatedBetween(l, curStart, now),
  );

  const closedCur = wonInPeriod.length + lostInPeriod.length;
  const closedPrev = wonPrevPeriod.length;
  const conversionPct = closedCur > 0 ? Math.round((wonInPeriod.length / closedCur) * 100) : 0;

  const hotUrgent = openLeads.filter((l) => {
    const t = deriveLeadTemperature(l);
    return t === 'quente' || t === 'urgente';
  });

  const hotPrev = periodPrevious.filter((l) => {
    const t = deriveLeadTemperature(l);
    return t === 'quente' || t === 'urgente';
  });

  const funnelStages = [...stages].filter((s) => !s.is_won && !s.is_lost).sort((a, b) => a.sort_order - b.sort_order);
  const funnel: FunnelRow[] = funnelStages.map((stage, idx) => {
    const count = scoped.filter((l) => l.stage_id === stage.id).length;
    const prevCount = idx > 0 ? scoped.filter((l) => l.stage_id === funnelStages[idx - 1]!.id).length : null;
    const conversionPct =
      prevCount != null && prevCount > 0 ? Math.round((count / prevCount) * 100) : idx === 0 ? 100 : null;
    return {
      stageId: stage.id,
      name: stage.name,
      count,
      color: stage.color,
      conversionPct,
    };
  });

  const sourceKeys: CommercialLeadSource[] = ['instagram', 'whatsapp', 'indicacao', 'manual', 'campanha'];
  const bySource: PieRow[] = sourceKeys
    .map((key) => ({
      key,
      name: commercialSourceLabel(key),
      value: scoped.filter((l) => l.source === key).length,
      color: SOURCE_COLORS[key],
    }))
    .filter((r) => r.value > 0);

  const tempKeys: LeadTemperature[] = ['urgente', 'quente', 'morno', 'frio'];
  const byTemperature: PieRow[] = tempKeys
    .map((key) => ({
      key,
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value: scoped.filter((l) => deriveLeadTemperatureWithStages(l, stages) === key).length,
      color: TEMPERATURE_COLORS[key],
    }))
    .filter((r) => r.value > 0);

  const ownerIds = [...new Set(scoped.map((l) => l.owner_id))];
  const ownerPerformance: OwnerPerfRow[] = ownerIds
    .map((ownerId) => {
      const ownerLeads = scoped.filter((l) => l.owner_id === ownerId);
      const ownerOpen = ownerLeads.filter((l) => openLeads.some((o) => o.id === l.id));
      return {
        ownerId,
        name: ownerNames.get(ownerId) ?? ownerId,
        pipelineCents: pipelineWeightedValueCents(ownerOpen, stages),
        wonCount: ownerLeads.filter((l) => l.stage_id === wonStage?.id).length,
        openCount: ownerOpen.length,
      };
    })
    .sort((a, b) => b.pipelineCents - a.pipelineCents);

  const topDeals: TopDealRow[] = [...openLeads]
    .filter(
      (l) =>
        l.deal_value_cents &&
        l.deal_value_cents > 0 &&
        l.operational_snapshot &&
        typeof l.operational_snapshot === 'object' &&
        Boolean((l.operational_snapshot as { perfil_operacao?: string }).perfil_operacao),
    )
    .sort((a, b) => (b.deal_value_cents ?? 0) - (a.deal_value_cents ?? 0))
    .slice(0, 5)
    .map((l) => {
      const stage = stages.find((s) => s.id === l.stage_id);
      return {
        id: l.id,
        trade_name: l.trade_name,
        deal_value_cents: l.deal_value_cents!,
        stageName: stage?.name ?? '—',
        stageColor: stage?.color ?? 'var(--chart-1)',
        temperature: deriveLeadTemperature(l),
        owner_id: l.owner_id,
      };
    });

  const cycleDays = wonInPeriod
    .map((l) => (new Date(l.updated_at).getTime() - new Date(l.created_at).getTime()) / 86400000)
    .filter((d) => d >= 0);
  const avgCycleDays = cycleDays.length ? Math.round(cycleDays.reduce((a, b) => a + b, 0) / cycleDays.length) : null;

  const timeSeries = buildTimeSeries(scoped, wonStage?.id, lostStage?.id, filters.periodDays);
  const pipelineSparkline = timeSeries.map((b) => b.created);

  const openPrevSnapshot = periodPrevious.filter((l) => {
    const stage = stages.find((s) => s.id === l.stage_id);
    return stage && !isTerminalStage(stage);
  });

  const deltas = filters.compare
    ? {
        created: pctDelta(periodCurrent.length, periodPrevious.length),
        won: pctDelta(wonInPeriod.length, wonPrevPeriod.length),
        conversion:
          closedCur > 0 && closedPrev > 0
            ? pctDelta(conversionPct, Math.round((wonPrevPeriod.length / closedPrev) * 100))
            : null,
        hotUrgent: pctDelta(hotUrgent.length, hotPrev.length),
        pipelineWeighted: pctDelta(openLeads.length, openPrevSnapshot.length),
      }
    : null;

  return {
    hero: {
      pipelineWeightedCents,
      closedWonCents,
      conversionPct,
      hotUrgentCount: hotUrgent.length,
      pipelineSparkline,
    },
    deltas,
    secondary: {
      createdInPeriod: periodCurrent.length,
      wonInPeriod: wonInPeriod.length,
      lostInPeriod: lostInPeriod.length,
      proposalsOpen: openLeads.filter((l) => proposalStageIds.has(l.stage_id)).length,
      avgCycleDays,
      stagnantCount: listStagnantLeads(scoped, stages).length,
    },
    funnel,
    timeSeries,
    bySource,
    byTemperature,
    ownerPerformance,
    topDeals,
    attention: {
      hotUrgent: hotUrgent.slice(0, 5),
      stagnant: listStagnantLeads(scoped, stages).slice(0, 5),
      followUpLate: followUpLateLeads(scoped, stages).slice(0, 5),
    },
  };
}

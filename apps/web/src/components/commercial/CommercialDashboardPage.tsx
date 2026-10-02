'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowRight,
  Briefcase,
  Clock,
  FileText,
  Flame,
  Inbox,
  Plus,
  TrendingDown,
  TrendingUp,
  Trophy,
  UserPlus,
  Wallet,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { PageHeader } from '@/components/ui/PageHeader';
import { CommercialReviveKpiCard } from '@/components/commercial/CommercialReviveKpiCard';
import { CommercialEmptyState } from '@/components/commercial/CommercialEmptyState';
import { CommercialStagnantBanner } from '@/components/commercial/CommercialStagnantBanner';
import { useCommercialProposalsEnabled } from '@/lib/commercial/useCommercialQueries';
import {
  buildCommercialDashboardMetrics,
  deltaTone,
  formatDeltaLabel,
} from '@/lib/commercial/commercialDashboardMetrics';
import { formatDealValueCents, leadTemperatureLabel, leadTemperatureTone } from '@/lib/commercial/commercialFormat';
import {
  useCommercialDashboard,
  useCommercialOwners,
  useLeads,
  usePipelineStages,
} from '@/lib/commercial/useCommercialQueries';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import { commercialSourceLabel } from '@/lib/commercial/commercialFormat';
import type { CommercialLead, CommercialLeadSource } from '@/lib/commercial/types';
import { buttonVariants } from '@/components/ui/button';
import {
  chartAxisStroke,
  chartGridStroke,
  chartLegendStyle,
  chartSeries,
  chartTickProps,
  chartTooltipStyle,
} from '@/lib/chartTheme';
import { cn } from '@/lib/utils';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { SegmentedControl } from '@/components/ui/SegmentedControl';

function ChartShell({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-xl border border-border bg-surface p-5', className)}>
      <h2 className="mb-4 text-sm font-semibold tracking-tight">{title}</h2>
      {children}
    </section>
  );
}

export function CommercialDashboardPage() {
  const [period, setPeriod] = useState<7 | 30 | 90>(30);
  const [compare, setCompare] = useState(true);
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | CommercialLeadSource>('all');

  const { data: leadsRes, isLoading } = useLeads({ limit: 500 });
  const { data: stages = [] } = usePipelineStages();
  const { data: owners = [] } = useCommercialOwners();
  const { data: dashboard } = useCommercialDashboard({
    owner_id: ownerFilter !== 'all' ? ownerFilter : undefined,
    source: sourceFilter !== 'all' ? sourceFilter : undefined,
  });
  const { data: proposalsEnabled = false } = useCommercialProposalsEnabled();

  const leads = useMemo(() => leadsRes?.data ?? [], [leadsRes?.data]);

  const ownerNames = useMemo(() => new Map(owners.map((o) => [o.id, o.name])), [owners]);

  const metrics = useMemo(
    () =>
      buildCommercialDashboardMetrics(
        leads,
        stages,
        {
          periodDays: period,
          ownerId: ownerFilter,
          source: sourceFilter,
          compare,
        },
        ownerNames,
      ),
    [leads, stages, period, ownerFilter, sourceFilter, compare, ownerNames],
  );

  if (isLoading) {
    return (
      <div>
        <PageHeader icon={Briefcase} eyebrow="Comercial" title="Dashboard" description="Carregando..." />
        <CommercialListSkeleton rows={6} />
      </div>
    );
  }

  if (leads.length === 0) {
    return (
      <div>
        <PageHeader
          icon={Briefcase}
          eyebrow="Comercial"
          title="Dashboard"
          description="Command center do funil comercial."
        />
        <CommercialEmptyState
          icon={Inbox}
          title="Nenhum lead no workspace"
          description="Cadastre o primeiro lead para acompanhar o funil comercial."
          actionLabel="Cadastrar primeiro lead"
          actionHref="/commercial/leads/new"
        />
      </div>
    );
  }

  const d = metrics.deltas;

  return (
    <div className="pb-8">
      <PageHeader
        icon={Briefcase}
        eyebrow="Comercial"
        title="Dashboard"
        description={
          dashboard
            ? `Pipeline ponderado ${formatDealValueCents(dashboard.weighted_pipeline_cents)} · ${dashboard.stagnant_count} estagnados (API)`
            : 'Pipeline, conversão e prioridades do período.'
        }
        actions={
          <>
            <SegmentedControl
              variant="primary"
              size="xs"
              value={String(period) as '7' | '30' | '90'}
              onChange={(v) => setPeriod(Number(v) as 7 | 30 | 90)}
              items={[
                { id: '7', label: '7d' },
                { id: '30', label: '30d' },
                { id: '90', label: '90d' },
              ]}
            />
            <Link href="/commercial/leads/new" className={buttonVariants({ size: 'sm' })}>
              <Plus className="h-3.5 w-3.5" />
              Novo lead
            </Link>
          </>
        }
      />

      <CommercialStagnantBanner leads={leads} stages={stages} />

      <div className="mb-6 rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center gap-2">
          <ToolbarSelect
            value={ownerFilter}
            onChange={setOwnerFilter}
            aria-label="Filtrar por vendedor"
            options={[
              { value: 'all', label: 'Todos vendedores' },
              ...owners.map((o) => ({ value: o.id, label: o.name })),
            ]}
          />
          <ToolbarSelect
            value={sourceFilter}
            onChange={(v) => setSourceFilter(v as typeof sourceFilter)}
            aria-label="Filtrar por origem"
            options={[
              { value: 'all', label: 'Todas origens' },
              ...(['manual', 'instagram', 'indicacao', 'whatsapp', 'campanha'] as CommercialLeadSource[]).map((s) => ({
                value: s,
                label: commercialSourceLabel(s),
              })),
            ]}
          />
          <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={compare}
              onChange={(e) => setCompare(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Comparar período anterior
          </label>
        </div>
      </div>

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <CommercialReviveKpiCard
          label="Pipeline ponderado"
          value={formatDealValueCents(metrics.hero.pipelineWeightedCents)}
          icon={Wallet}
          tone="primary"
          size="lg"
          sparkline={metrics.hero.pipelineSparkline}
          deltaLabel={compare ? formatDeltaLabel(d?.pipelineWeighted ?? null) : undefined}
          deltaTone={deltaTone(d?.pipelineWeighted ?? null)}
        />
        <CommercialReviveKpiCard
          label="Fechado no período"
          value={formatDealValueCents(metrics.hero.closedWonCents)}
          icon={Trophy}
          tone="success"
          size="lg"
          valueClassName="text-success"
          deltaLabel={compare ? formatDeltaLabel(d?.won ?? null) : undefined}
          deltaTone={deltaTone(d?.won ?? null)}
        />
        <CommercialReviveKpiCard
          label="Taxa de conversão"
          value={`${metrics.hero.conversionPct}%`}
          icon={TrendingUp}
          tone="info"
          size="lg"
          valueClassName="text-primary"
          deltaLabel={compare ? formatDeltaLabel(d?.conversion ?? null) : undefined}
          deltaTone={deltaTone(d?.conversion ?? null)}
        />
        <CommercialReviveKpiCard
          label="Quentes + urgentes"
          value={metrics.hero.hotUrgentCount}
          icon={Flame}
          tone="warning"
          size="lg"
          valueClassName="text-warning"
          deltaLabel={compare ? formatDeltaLabel(d?.hotUrgent ?? null) : undefined}
          deltaTone={deltaTone(d?.hotUrgent ?? null)}
        />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <CommercialReviveKpiCard
          label="Leads criados"
          value={metrics.secondary.createdInPeriod}
          icon={UserPlus}
          tone="info"
          deltaLabel={compare && d?.created != null ? formatDeltaLabel(d.created) : undefined}
          deltaTone={d?.created != null ? deltaTone(d.created) : 'muted'}
        />
        <CommercialReviveKpiCard
          label="Ganhos"
          value={metrics.secondary.wonInPeriod}
          icon={Trophy}
          tone="success"
          valueClassName="text-success"
        />
        <CommercialReviveKpiCard
          label="Perdidos"
          value={metrics.secondary.lostInPeriod}
          icon={TrendingDown}
          tone="destructive"
          valueClassName="text-destructive"
        />
        {proposalsEnabled ? (
          <CommercialReviveKpiCard
            label="Propostas ativas"
            value={metrics.secondary.proposalsOpen}
            icon={FileText}
            tone="warning"
            valueClassName="text-warning"
          />
        ) : null}
        <CommercialReviveKpiCard
          label="Ciclo médio"
          value={metrics.secondary.avgCycleDays != null ? `${metrics.secondary.avgCycleDays}d` : '—'}
          icon={Clock}
          tone="muted"
        />
        <CommercialReviveKpiCard
          label="Estagnados"
          value={metrics.secondary.stagnantCount}
          icon={AlertTriangle}
          tone="warning"
          valueClassName={metrics.secondary.stagnantCount > 0 ? 'text-warning' : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ChartShell title="Funil por estágio">
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.funnel} layout="vertical" margin={{ left: 8, right: 24 }}>
                <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" stroke={chartAxisStroke} tick={chartTickProps} allowDecimals={false} />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={88}
                  stroke={chartAxisStroke}
                  tick={chartTickProps}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  formatter={(value, _name, item) => {
                    const n = typeof value === 'number' ? value : 0;
                    const row = item?.payload as { conversionPct?: number | null } | undefined;
                    const conv = row?.conversionPct != null ? ` · ${row.conversionPct}% do anterior` : '';
                    return [`${n}${conv}`, 'Leads'];
                  }}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={22}>
                  {metrics.funnel.map((row) => (
                    <Cell key={row.stageId} fill={row.color} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {metrics.funnel.map((row) => (
              <Link
                key={row.stageId}
                href={`/commercial/pipeline`}
                className="text-[10px] text-muted-foreground hover:text-primary"
              >
                {row.name}: {row.count}
                {row.conversionPct != null && row.conversionPct < 100 ? ` (${row.conversionPct}%)` : ''}
              </Link>
            ))}
          </div>
        </ChartShell>

        <ChartShell title={`Leads criados × ganhos · ${period}d`}>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={metrics.timeSeries}>
                <defs>
                  <linearGradient id="fillCreated" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartSeries.primary} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={chartSeries.primary} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="fillWon" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chartSeries.success} stopOpacity={0.35} />
                    <stop offset="100%" stopColor={chartSeries.success} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 3" />
                <XAxis dataKey="label" stroke={chartAxisStroke} tick={chartTickProps} />
                <YAxis stroke={chartAxisStroke} tick={chartTickProps} allowDecimals={false} />
                <Tooltip contentStyle={chartTooltipStyle} />
                <Legend wrapperStyle={chartLegendStyle} />
                <Area
                  type="monotone"
                  dataKey="created"
                  name="Criados"
                  stroke={chartSeries.primary}
                  fill="url(#fillCreated)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="won"
                  name="Ganhos"
                  stroke={chartSeries.success}
                  fill="url(#fillWon)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </ChartShell>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <ChartShell title="Origem dos leads">
          <div className="h-56">
            {metrics.bySource.length === 0 ? (
              <p className="flex h-full items-center justify-center text-xs text-muted-foreground">Sem dados</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics.bySource}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={76}
                    paddingAngle={2}
                  >
                    {metrics.bySource.map((e) => (
                      <Cell key={e.key} fill={e.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={chartLegendStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartShell>

        <ChartShell title="Temperatura">
          <div className="h-56">
            {metrics.byTemperature.length === 0 ? (
              <p className="flex h-full items-center justify-center text-xs text-muted-foreground">Sem dados</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={metrics.byTemperature}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={48}
                    outerRadius={76}
                    paddingAngle={2}
                  >
                    {metrics.byTemperature.map((e) => (
                      <Cell key={e.key} fill={e.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={chartLegendStyle} />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartShell>

        <ChartShell title="Pipeline por vendedor (R$ ponderado)">
          <div className="h-56">
            {metrics.ownerPerformance.length === 0 ? (
              <p className="flex h-full items-center justify-center text-xs text-muted-foreground">Sem dados</p>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metrics.ownerPerformance} layout="vertical" margin={{ left: 4, right: 8 }}>
                  <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 3" horizontal={false} />
                  <XAxis
                    type="number"
                    stroke={chartAxisStroke}
                    tick={chartTickProps}
                    tickFormatter={(v) => `${(v / 100000).toFixed(0)}k`}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={72}
                    stroke={chartAxisStroke}
                    tick={chartTickProps}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={chartTooltipStyle}
                    formatter={(v) => [formatDealValueCents(typeof v === 'number' ? v : 0), 'Pipeline']}
                  />
                  <Bar dataKey="pipelineCents" fill={chartSeries.primary} radius={[0, 4, 4, 0]} maxBarSize={18} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </ChartShell>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-border bg-surface p-5">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Top negócios abertos</h2>
            <Link href="/commercial/pipeline" className="text-xs font-medium text-primary hover:underline">
              Ver pipeline
            </Link>
          </div>
          {metrics.topDeals.length === 0 ? (
            <p className="text-sm text-muted-foreground">Informe valor estimado nos leads.</p>
          ) : (
            <ul className="space-y-2">
              {metrics.topDeals.map((deal, i) => (
                <li key={deal.id}>
                  <Link
                    href={`/commercial/leads/${deal.id}`}
                    className="flex items-center gap-3 rounded-lg border border-border bg-background px-3 py-2.5 transition-colors hover:bg-sidebar-accent/60"
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{deal.trade_name}</p>
                      <p className="text-[11px] text-muted-foreground">
                        <span style={{ color: deal.stageColor }}>{deal.stageName}</span>
                        {' · '}
                        {ownerNames.get(deal.owner_id) ?? '—'}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-semibold tabular-nums">
                        {deal.deal_value_cents ? formatDealValueCents(deal.deal_value_cents) : 'Sem viabilidade'}
                      </p>
                      <span
                        className={cn(
                          'mt-1 inline-flex rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase',
                          leadTemperatureTone(deal.temperature),
                        )}
                      >
                        {leadTemperatureLabel(deal.temperature)}
                      </span>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-border bg-surface p-5">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
            <AlertTriangle className="h-4 w-4 text-warning" />
            Atenção agora
          </h2>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
            <AttentionList
              title="Quentes / urgentes"
              empty="Nenhum lead quente"
              leads={metrics.attention.hotUrgent}
              accent="border-l-destructive"
            />
            <AttentionList
              title="Estagnados"
              empty="Funil em movimento"
              leads={metrics.attention.stagnant}
              accent="border-l-warning"
            />
            <AttentionList
              title="Follow-up atrasado"
              empty="SLA em dia"
              leads={metrics.attention.followUpLate}
              accent="border-l-primary"
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function AttentionList({
  title,
  empty,
  leads,
  accent,
}: {
  title: string;
  empty: string;
  leads: CommercialLead[];
  accent: string;
}) {
  return (
    <div className={cn('rounded-lg border border-border border-l-4 bg-surface p-3', accent)}>
      <p className="text-xs font-medium text-foreground">{title}</p>
      {leads.length === 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">{empty}</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {leads.map((lead) => (
            <li key={lead.id}>
              <Link
                href={`/commercial/leads/${lead.id}`}
                className="flex items-center justify-between gap-2 text-xs hover:text-primary"
              >
                <span className="truncate font-medium">{lead.trade_name}</span>
                <ArrowRight className="h-3 w-3 shrink-0 opacity-50" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

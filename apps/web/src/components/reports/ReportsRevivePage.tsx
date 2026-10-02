'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  BarChart3,
  Clock,
  Download,
  FileText,
  Filter,
  MessageSquare,
  RefreshCw,
  Search,
  Smile,
  Target,
  Users,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import {
  downloadReportCsv,
  fetchAttendantRanking,
  fetchReportSummary,
  fmtSec,
  type ReportKpis,
} from '@/lib/reports/reportsApi';
import {
  chartAxisStroke,
  chartColor,
  chartGridStroke,
  chartLegendStyle,
  chartSeries,
  chartTickProps,
  chartTooltipStyle,
} from '@/lib/chartTheme';
import { reviveOutlineButtonClassName, reviveTableHeadRowClassName, reviveTableShellClassName } from '@/lib/reviveSurfaces';

const PERIOD_PRESETS = [
  { id: 1, label: 'Hoje' },
  { id: 7, label: '7 dias' },
  { id: 30, label: '30 dias' },
  { id: 90, label: '90 dias' },
] as const;

const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: 'WhatsApp',
  instagram: 'Instagram',
  email: 'Email',
  commercial_lead: 'Lead comercial',
  driver: 'Entregador',
  pharmacy: 'Farmácia',
  unknown: 'Outros',
  webchat: 'Webchat',
};

const CHANNEL_COLOR: Record<string, string> = {
  whatsapp: 'var(--channel-whatsapp)',
  instagram: 'var(--channel-instagram)',
  email: 'var(--channel-email)',
};

function colorForChannel(channel: string, index: number): string {
  return CHANNEL_COLOR[channel.toLowerCase()] ?? chartColor(index);
}

function formatPeriodLabel(since: string, until: string) {
  const s = new Date(since).toLocaleDateString('pt-BR');
  const e = new Date(until).toLocaleDateString('pt-BR');
  return `${s} — ${e}`;
}

function KpiCard({
  icon: Icon,
  label,
  value,
  delta,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  delta: number | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        {delta != null ? (
          <span
            className={cn(
              'flex items-center gap-0.5 font-mono text-[10px]',
              delta >= 0 ? 'text-success' : 'text-destructive',
            )}
          >
            {delta >= 0 ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />}
            {Math.abs(delta).toFixed(1)}%
          </span>
        ) : null}
      </div>
      <div className="mt-2 font-mono text-xl font-semibold">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function MiniKpi({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2">
      <div className="flex h-8 w-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
      </div>
      <div>
        <div className="font-mono text-sm font-semibold">{value}</div>
        <div className="text-[10px] text-muted-foreground">{label}</div>
      </div>
    </div>
  );
}

function HeatmapGrid({ grid, dayLabels }: { grid: number[][]; dayLabels: string[] }) {
  const max = Math.max(1, ...grid.flat());
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <h3 className="mb-3 text-sm font-semibold">Heatmap dia × hora</h3>
      <div className="overflow-x-auto">
        <div className="inline-block">
          <div className="flex">
            <div className="w-10" />
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="w-5 text-center font-mono text-[9px] text-muted-foreground">
                {h}
              </div>
            ))}
          </div>
          {grid.map((row, d) => (
            <div key={dayLabels[d] ?? d} className="flex items-center">
              <div className="w-10 font-mono text-[10px] text-muted-foreground">{dayLabels[d] ?? '—'}</div>
              {row.map((v, h) => {
                const op = v / max;
                return (
                  <div
                    key={h}
                    className="m-px h-4 w-4 rounded-sm"
                    title={`${dayLabels[d] ?? ''} ${h}h: ${v}`}
                    style={{
                      backgroundColor: `color-mix(in oklch, var(--primary) ${Math.round((0.08 + op * 0.92) * 100)}%, transparent)`,
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function ReportsRevivePage() {
  const [period, setPeriod] = useState(30);
  const [compare, setCompare] = useState(true);
  const [granularity, setGranularity] = useState<'day' | 'week' | 'month'>('day');
  const [search, setSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const summaryQuery = useQuery({
    queryKey: ['reports-summary', period, compare, granularity, search],
    queryFn: () =>
      fetchReportSummary({
        period,
        compare,
        granularity,
        search: search.trim() || undefined,
      }),
  });

  const rankingQuery = useQuery({
    queryKey: ['reports-attendants', period],
    queryFn: () => fetchAttendantRanking(period),
  });

  const summary = summaryQuery.data;
  const kpis: ReportKpis = summary?.kpis ?? {
    tickets: 0,
    resolved: 0,
    tmr_seconds: 0,
    tma_seconds: 0,
    tme_seconds: 0,
    sla_pct: 0,
    csat_avg: null,
    fcr_pct: 0,
    reopen_pct: 0,
    transfer_pct: 0,
    messages_inbound: 0,
    messages_outbound: 0,
  };
  const deltas = summary?.deltas;

  const porCanal = useMemo(
    () =>
      (summary?.by_channel ?? []).map((c, i) => ({
        name: CHANNEL_LABEL[c.channel] ?? c.channel,
        value: c.count,
        color: colorForChannel(c.channel, i),
      })),
    [summary?.by_channel],
  );

  const porFila = useMemo(
    () => (summary?.by_sector ?? []).map((s) => ({ name: s.name, tickets: s.count })),
    [summary?.by_sector],
  );

  const porTag = summary?.by_tag ?? [];

  const handleExport = async () => {
    setExporting(true);
    try {
      const blob = await downloadReportCsv({ period, compare, granularity, search: search.trim() || undefined });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `relatorio-atendimento-${period}d.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          icon={BarChart3}
          eyebrow="Relatórios"
          title="Desempenho de Atendimento"
          description={
            summary
              ? `Período: ${formatPeriodLabel(summary.since, summary.until)} · ${kpis.tickets} tickets`
              : 'Carregando indicadores…'
          }
          actions={
            <>
              <button
                type="button"
                onClick={() => void summaryQuery.refetch()}
                className={reviveOutlineButtonClassName}
              >
                <RefreshCw className={cn('h-3.5 w-3.5', summaryQuery.isFetching && 'animate-spin')} />
                Atualizar
              </button>
              <button type="button" onClick={() => void handleExport()} disabled={exporting} className={reviveOutlineButtonClassName}>
                <Download className="h-3.5 w-3.5" />
                {exporting ? 'Exportando…' : 'CSV'}
              </button>
              <button type="button" onClick={() => window.print()} className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow">
                <FileText className="h-3.5 w-3.5" />
                PDF
              </button>
            </>
          }
        />

        <div className="mb-4 rounded-xl border border-border bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Período</span>
            <div className="flex flex-wrap gap-1">
              {PERIOD_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={cn(
                    'rounded-md border px-2.5 py-1 text-[11px]',
                    period === p.id ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:bg-sidebar-accent/60',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="ml-auto flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-muted-foreground">
                <input
                  type="checkbox"
                  checked={compare}
                  onChange={(e) => setCompare(e.target.checked)}
                  className="h-3.5 w-3.5 rounded border-border"
                />
                Comparar com período anterior
              </label>
              <FormSelect
                value={granularity}
                onChange={(v) => setGranularity(v as 'day' | 'week' | 'month')}
                options={[
                  { value: 'day', label: 'Diário' },
                  { value: 'week', label: 'Semanal' },
                  { value: 'month', label: 'Mensal' },
                ]}
                className="min-w-[7rem] text-[11px]"
              />
            </div>
          </div>

          <div className="mt-3">
            <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">Busca</label>
            <div className="relative mt-1 max-w-md">
              <Search className="absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
              <FormControl
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Contato, ID…"
                inputSize="sm"
                className="pl-7 text-xs"
              />
            </div>
          </div>

          {search.trim() ? (
            <div className="mt-3 flex items-center justify-between border-t border-border pt-3">
              <span className="text-[11px] text-muted-foreground">Filtro de busca ativo</span>
              <button
                type="button"
                onClick={() => setSearch('')}
                className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] hover:bg-sidebar-accent/60"
              >
                <X className="h-3 w-3" /> Limpar
              </button>
            </div>
          ) : null}
        </div>

        {summaryQuery.isError ? (
          <p className="mb-4 text-sm text-destructive">Não foi possível carregar o relatório.</p>
        ) : null}

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard icon={Users} label="Tickets" value={String(kpis.tickets)} delta={compare ? (deltas?.tickets ?? null) : null} />
          <KpiCard icon={Clock} label="TMR (1ª resposta)" value={fmtSec(kpis.tmr_seconds)} delta={compare ? (deltas?.tmr_seconds != null ? -deltas.tmr_seconds : null) : null} />
          <KpiCard icon={Activity} label="TMA (duração)" value={fmtSec(kpis.tma_seconds)} delta={compare ? (deltas?.tma_seconds != null ? -deltas.tma_seconds : null) : null} />
          <KpiCard icon={Clock} label="TME (espera)" value={fmtSec(kpis.tme_seconds)} delta={compare ? (deltas?.tme_seconds != null ? -deltas.tme_seconds : null) : null} />
          <KpiCard icon={Target} label="SLA cumprido" value={`${kpis.sla_pct}%`} delta={compare ? (deltas?.sla_pct ?? null) : null} />
          <KpiCard icon={Smile} label="CSAT" value={kpis.csat_avg != null ? kpis.csat_avg.toFixed(2) : '—'} delta={compare ? (deltas?.csat_avg ?? null) : null} />
          <KpiCard icon={Target} label="FCR" value={`${kpis.fcr_pct}%`} delta={compare ? (deltas?.fcr_pct ?? null) : null} />
          <KpiCard icon={RefreshCw} label="Reabertura" value={`${kpis.reopen_pct}%`} delta={compare ? (deltas?.reopen_pct != null ? -deltas.reopen_pct : null) : null} />
        </div>

        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <MiniKpi icon={MessageSquare} label="Mensagens enviadas" value={kpis.messages_outbound.toLocaleString('pt-BR')} />
          <MiniKpi icon={MessageSquare} label="Mensagens recebidas" value={kpis.messages_inbound.toLocaleString('pt-BR')} />
          <MiniKpi icon={Activity} label="Transferências" value={`${kpis.transfer_pct}%`} />
          <MiniKpi icon={Users} label="Resolvidos" value={String(kpis.resolved)} />
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-4 lg:col-span-2">
            <h3 className="mb-3 text-sm font-semibold">Volume ao longo do tempo</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={summary?.series ?? []}>
                  <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="date" stroke={chartAxisStroke} tick={chartTickProps} />
                  <YAxis stroke={chartAxisStroke} tick={chartTickProps} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={chartLegendStyle} />
                  <Line type="monotone" dataKey="whatsapp" stroke={CHANNEL_COLOR.whatsapp} strokeWidth={2} dot={false} name="WhatsApp" />
                  <Line type="monotone" dataKey="instagram" stroke={CHANNEL_COLOR.instagram} strokeWidth={2} dot={false} name="Instagram" />
                  <Line type="monotone" dataKey="email" stroke={CHANNEL_COLOR.email} strokeWidth={2} dot={false} name="Email" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold">Por canal</h3>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={porCanal} dataKey="value" nameKey="name" innerRadius={50} outerRadius={80} paddingAngle={2}>
                    {porCanal.map((e) => (
                      <Cell key={e.name} fill={e.color} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Legend wrapperStyle={chartLegendStyle} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold">Tickets por setor</h3>
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={porFila}>
                  <CartesianGrid stroke={chartGridStroke} strokeDasharray="3 3" />
                  <XAxis dataKey="name" stroke={chartAxisStroke} tick={chartTickProps} />
                  <YAxis stroke={chartAxisStroke} tick={chartTickProps} />
                  <Tooltip contentStyle={chartTooltipStyle} />
                  <Bar dataKey="tickets" fill={chartSeries.primary} radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-4">
            <h3 className="mb-3 text-sm font-semibold">Tags / motivos</h3>
            <div className="space-y-1.5">
              {porTag.slice(0, 7).map((t) => {
                const max = porTag[0]?.count || 1;
                const pct = (t.count / max) * 100;
                return (
                  <div key={t.name} className="flex items-center gap-2">
                    <span className="w-32 truncate text-[11px]">{t.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-muted">
                      <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="w-10 text-right font-mono text-[11px] text-muted-foreground">{t.count}</span>
                  </div>
                );
              })}
              {porTag.length === 0 ? <div className="text-[11px] text-muted-foreground">Sem dados no período</div> : null}
            </div>
          </div>
        </div>

        {summary?.heatmap ? <HeatmapGrid grid={summary.heatmap.grid} dayLabels={summary.heatmap.day_labels} /> : null}

        <div className={cn(reviveTableShellClassName, 'mt-4')}>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <BarChart3 className="h-4 w-4" /> Ranking de atendentes
            </h3>
            <span className="text-[11px] text-muted-foreground">
              {(rankingQuery.data ?? []).length} atendente{(rankingQuery.data ?? []).length !== 1 ? 's' : ''}
            </span>
          </div>
          <table className="w-full text-sm">
            <thead className={reviveTableHeadRowClassName}>
              <tr>
                <th className="px-4 py-2.5 text-left">#</th>
                <th className="px-4 py-2.5 text-left">Atendente</th>
                <th className="px-4 py-2.5 text-right">Tickets</th>
                <th className="px-4 py-2.5 text-right">Resolvidos</th>
                <th className="px-4 py-2.5 text-right">SLA</th>
                <th className="px-4 py-2.5 text-right">TMA méd.</th>
              </tr>
            </thead>
            <tbody>
              {(rankingQuery.data ?? [])
                .sort((a, b) => b.total - a.total)
                .map((r, i) => (
                  <tr key={r.attendant.id} className="border-t border-border transition-colors hover:bg-sidebar-accent/40">
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-4 py-3">
                      <div className="text-xs font-medium">{r.attendant.name}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{r.total}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{r.resolved}</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">{r.sla_compliance_rate}%</td>
                    <td className="px-4 py-3 text-right font-mono text-xs">
                      {r.avg_resolution_minutes != null ? `${r.avg_resolution_minutes}m` : '—'}
                    </td>
                  </tr>
                ))}
              {(rankingQuery.data ?? []).length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-12 text-center text-xs text-muted-foreground">
                    Sem dados para o período
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

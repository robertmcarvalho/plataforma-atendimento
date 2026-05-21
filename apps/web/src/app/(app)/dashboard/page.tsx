'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowDown, ArrowUp, CheckCircle2, Clock, MessageSquare, TrendingUp, Users } from 'lucide-react';
import { ChannelBadge, type Channel } from '@/components/ui/ChannelBadge';
import { StatusDot } from '@/components/ui/StatusDot';
import api from '@/lib/api';
import { features } from '@/lib/features';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';

type UiAgentStatus = 'online' | 'idle' | 'offline' | 'busy';

type ApiDelta = { value: number; up: boolean };

type ApiDashboardOverview = {
  period_days: number;
  kpis: {
    conversations_today: number;
    avg_first_response_seconds: number | null;
    resolution_rate_percent: number | null;
    agents_online: { online: number; total: number };
  };
  deltas?: {
    conversations_today?: ApiDelta;
    avg_first_response_seconds?: ApiDelta;
    resolution_rate_percent?: ApiDelta;
    agents_online?: ApiDelta;
  };
  sla?: {
    overall_percent: number;
    first_response_percent: number;
    resolution_percent: number;
    at_risk_count: number;
    breached_count: number;
  };
  channels: Array<{ ch: Channel; pct: number; count: number }>;
  top_agents?: Array<{ id: string; name: string; initials: string; chats: number; csat: number | null; status: UiAgentStatus }>;
};

const enabledChannels: Channel[] = [
  'whatsapp',
  ...(features.channels.instagram ? (['instagram'] as Channel[]) : []),
  ...(features.channels.email ? (['email'] as Channel[]) : []),
];

const kpiMeta = [
  { key: 'conversations_today', label: 'Conversas hoje', icon: MessageSquare, accent: 'text-primary' },
  { key: 'avg_first_response_seconds', label: 'Tempo médio resposta', icon: Clock, accent: 'text-success' },
  { key: 'resolution_rate_percent', label: 'Taxa resolução', icon: CheckCircle2, accent: 'text-channel-instagram' },
  { key: 'agents_online', label: 'Agentes online', icon: Users, accent: 'text-warning' },
] as const;

function formatSecondsToShort(seconds: number | null) {
  if (!seconds || seconds <= 0) return '—';
  const min = Math.floor(seconds / 60);
  const sec = Math.floor(seconds % 60);
  if (min <= 0) return `${sec}s`;
  return `${min}m ${sec}s`;
}

function parseContentDispositionFilename(header: unknown) {
  if (typeof header !== 'string') return null;
  const match = /filename="([^"]+)"/i.exec(header);
  return match?.[1] || null;
}

// Sparkline pseudoaleatório (determinístico)
const sparkPoints = (seed: number) => {
  const pts: number[] = [];
  for (let i = 0; i < 24; i++) {
    pts.push(40 + Math.sin(i * 0.5 + seed) * 15 + Math.cos(i * 0.3 + seed * 2) * 10 + i * 0.8);
  }
  return pts;
};

const Sparkline = ({ seed, color = 'hsl(var(--primary))' }: { seed: number; color?: string }) => {
  const points = sparkPoints(seed);
  const max = Math.max(...points);
  const min = Math.min(...points);
  const path = points
    .map((p, i) => {
      const x = (i / (points.length - 1)) * 100;
      const y = 100 - ((p - min) / (max - min)) * 100;
      return `${i === 0 ? 'M' : 'L'}${x},${y}`;
    })
    .join(' ');
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-10 w-full">
      <defs>
        <linearGradient id={`grad-${seed}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={`${path} L100,100 L0,100 Z`} fill={`url(#grad-${seed})`} />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
};

const pseudo = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
};

// Gráfico de volume (24h) — visual (não representa o volume real ainda)
const VolumeChart = () => {
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const data = hours.map((h) => Math.round(20 + Math.sin(h * 0.4) * 15 + pseudo(h + 7) * 25 + (h > 8 && h < 20 ? 30 : 0)));
  const max = Math.max(...data);
  return (
    <div className="flex h-48 items-end gap-1.5">
      {data.map((v, i) => (
        <div key={i} className="group flex flex-1 flex-col items-center gap-1">
          <div
            className="w-full rounded-t bg-gradient-to-t from-primary/40 to-primary transition-all hover:from-primary hover:to-primary-glow"
            style={{ height: `${(v / max) * 100}%`, minHeight: '4px' }}
          />
          {i % 4 === 0 && <span className="font-mono text-[9px] text-subtle-foreground">{i}h</span>}
        </div>
      ))}
    </div>
  );
};

export default function DashboardPage() {
  const [periodDays, setPeriodDays] = useState(1);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard', 'overview', periodDays],
    queryFn: () =>
      api.get('/api/dashboard/overview', { params: { period: String(periodDays) } }).then((r) => r.data as ApiDashboardOverview),
  });

  const headerDate = useMemo(() => {
    const today = format(new Date(), 'dd MMM', { locale: ptBR }).replace('.', '');
    if (periodDays === 1) return `Hoje · ${today}`;
    return `Últimos ${periodDays} dias`;
  }, [periodDays]);

  const kpis = useMemo(() => {
    const base = data?.kpis;
    return [
      base ? String(base.conversations_today) : '—',
      base ? formatSecondsToShort(base.avg_first_response_seconds) : '—',
      base?.resolution_rate_percent != null ? `${Number(base.resolution_rate_percent).toFixed(1)}%` : '—',
      base ? `${base.agents_online.online} / ${base.agents_online.total}` : '—',
    ];
  }, [data?.kpis]);

  const kpiDeltas = useMemo(() => {
    const zero: ApiDelta = { value: 0, up: true };
    return {
      conversations_today: data?.deltas?.conversations_today ?? zero,
      avg_first_response_seconds: data?.deltas?.avg_first_response_seconds ?? zero,
      resolution_rate_percent: data?.deltas?.resolution_rate_percent ?? zero,
      agents_online: data?.deltas?.agents_online ?? zero,
    };
  }, [data?.deltas]);

  const sla = useMemo(() => {
    return (
      data?.sla || {
        overall_percent: 0,
        first_response_percent: 0,
        resolution_percent: 0,
        at_risk_count: 0,
        breached_count: 0,
      }
    );
  }, [data?.sla]);

  const channelStats = useMemo(() => {
    const enabled = new Set(enabledChannels);
    const incoming = data?.channels || [];
    const filtered = incoming.filter((c) => enabled.has(c.ch));
    if (filtered.length > 0) return filtered;
    return [{ ch: 'whatsapp' as Channel, pct: 100, count: 0 }];
  }, [data?.channels]);

  const agents = useMemo(() => data?.top_agents || [], [data?.top_agents]);

  const onExport = async () => {
    if (exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const res = await api.get('/api/dashboard/export', {
        params: { period: String(periodDays) },
        responseType: 'blob',
      });
      const blob = new Blob([res.data], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = parseContentDispositionFilename(res.headers?.['content-disposition']) || `dashboard-export-${periodDays}d.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setExportError(msg || 'Falha ao exportar.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="h-full overflow-y-auto bg-gradient-glow">
      <div className="mx-auto max-w-7xl px-8 py-8">
        {/* Header */}
        <div className="mb-8 flex items-end justify-between">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">Dashboard</div>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Visão geral</h1>
            <p className="mt-1 text-sm text-muted-foreground">Acompanhe o desempenho do atendimento em tempo real.</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs">
              <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
              <span className="text-muted-foreground">Ao vivo</span>
            </div>

            <div className="relative">
              <button
                onClick={() => setPeriodOpen((v) => !v)}
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
                aria-expanded={periodOpen}
              >
                {headerDate}
              </button>
              {periodOpen ? (
                <div className="absolute right-0 top-10 z-30 w-44 rounded-xl border border-border bg-surface-elevated p-1 shadow-glow">
                  {[
                    { days: 1, label: 'Hoje' },
                    { days: 7, label: 'Últimos 7 dias' },
                    { days: 30, label: 'Últimos 30 dias' },
                  ].map((p) => (
                    <button
                      key={p.days}
                      onClick={() => {
                        setPeriodDays(p.days);
                        setPeriodOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-surface-hover',
                        periodDays === p.days ? 'text-foreground' : 'text-muted-foreground'
                      )}
                    >
                      <span>{p.label}</span>
                      {periodDays === p.days ? <span className="font-mono text-[10px] text-primary">✓</span> : null}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <button
              onClick={() => void onExport()}
              disabled={exporting}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow transition-colors disabled:opacity-60"
            >
              {exporting ? 'Exportando…' : 'Exportar'}
            </button>
          </div>
        </div>

        {exportError ? <div className="mb-4 text-xs text-destructive">{exportError}</div> : null}
        {isError ? (
          <div className="mb-4 text-sm text-muted-foreground">
            Falha ao carregar o dashboard.
            <button onClick={() => void refetch()} className="ml-2 text-primary hover:underline">
              Tentar novamente
            </button>
          </div>
        ) : null}

        {/* KPI Row */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
          {kpiMeta.map((k, idx) => {
            const Icon = k.icon;
            const val = kpis[idx] || '—';
            const delta =
              k.key === 'conversations_today'
                ? kpiDeltas.conversations_today
                : k.key === 'avg_first_response_seconds'
                  ? kpiDeltas.avg_first_response_seconds
                  : k.key === 'resolution_rate_percent'
                    ? kpiDeltas.resolution_rate_percent
                    : kpiDeltas.agents_online;
            const neutral = Math.abs(delta.value || 0) === 0;
            return (
              <div
                key={k.label}
                className="rounded-xl border border-border bg-surface p-6 hover:bg-surface-hover transition-colors"
                role="group"
              >
                <div className="flex items-center justify-between">
                  <div className="text-xs font-medium text-muted-foreground">{k.label}</div>
                  <Icon className={cn('h-4 w-4', k.accent)} />
                </div>
                <div className="mt-3 flex items-baseline gap-2">
                  <div className={cn('text-2xl font-semibold tracking-tight', isLoading ? 'text-muted-foreground' : '')}>{val}</div>
                  <div
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-mono',
                      neutral ? 'bg-muted text-muted-foreground' : delta.up ? 'bg-success/15 text-success' : 'bg-warning/15 text-warning'
                    )}
                  >
                    {neutral ? null : delta.up ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />}
                    {delta.value.toFixed(1)}%
                  </div>
                </div>
                <div className="mt-2">
                  <Sparkline seed={idx + 1} color={idx === 1 ? 'hsl(var(--success))' : 'hsl(var(--primary))'} />
                </div>
              </div>
            );
          })}
        </div>

        {/* Main Charts */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="lg:col-span-2 rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Volume de conversas</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Últimas 24h</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-mono text-muted-foreground">0.0%</div>
                <TrendingUp className="h-4 w-4 text-muted-foreground" />
              </div>
            </div>
            <div className="mt-6">
              <VolumeChart />
            </div>
          </div>

          <div className="rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Canais</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Distribuição</p>
              </div>
              <div className="text-[10px] font-mono text-subtle-foreground">{data?.period_days ?? periodDays}d</div>
            </div>

            <div className="mt-5 space-y-4">
              {channelStats.map(({ ch, pct, count }) => (
                <div key={ch} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <ChannelBadge channel={ch} showLabel />
                    <div className="flex items-baseline gap-1.5">
                      <span className="font-mono text-xs">{count}</span>
                      <span className="font-mono text-[10px] text-subtle-foreground">{pct}%</span>
                    </div>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-background/60">
                    <div className={cn('h-full rounded-full transition-all', `bg-channel-${ch}`)} style={{ width: `${pct}%` }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* SLA + Agents */}
        <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold tracking-tight">SLA</h3>
              <TrendingUp className={cn('h-3.5 w-3.5', sla.overall_percent > 0 ? 'text-success' : 'text-muted-foreground')} />
            </div>
            <div className="mt-4 flex items-baseline gap-2">
              <div className={cn('text-3xl font-semibold tracking-tight', sla.overall_percent > 0 ? 'gradient-text' : 'text-muted-foreground')}>
                {sla.overall_percent.toFixed(1)}%
              </div>
              <span className="text-xs text-muted-foreground font-mono">0.0pp</span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">Conversas dentro do SLA</p>

            <div className="mt-5 space-y-2.5">
              {[
                { label: 'Primeira resposta', val: `${sla.first_response_percent.toFixed(1)}%`, color: 'bg-success' },
                { label: 'Resolução', val: `${sla.resolution_percent.toFixed(1)}%`, color: 'bg-primary' },
                { label: 'Tempo de fila', val: '0.0%', color: 'bg-warning' },
              ].map((s) => (
                <div key={s.label}>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-muted-foreground">{s.label}</span>
                    <span className="font-mono">{s.val}</span>
                  </div>
                  <div className="mt-1 h-1 rounded-full bg-background/60 overflow-hidden">
                    <div className={cn('h-full', s.color)} style={{ width: s.val }} />
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-4 grid grid-cols-2 gap-2 text-[10px] text-subtle-foreground">
              <div className="rounded-md border border-border bg-background/40 px-2 py-1">
                Em risco (30m): <span className="font-mono text-foreground">{sla.at_risk_count}</span>
              </div>
              <div className="rounded-md border border-border bg-background/40 px-2 py-1">
                Vencido: <span className="font-mono text-foreground">{sla.breached_count}</span>
              </div>
            </div>
          </div>

          <div className="lg:col-span-2 rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold tracking-tight">Top agentes</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {periodDays === 1 ? 'Hoje' : `Últimos ${periodDays} dias`} · ordenado por volume
                </p>
              </div>
              <Link href="/leaders" className="text-[11px] font-medium text-primary hover:underline">
                Ver todos →
              </Link>
            </div>

            <div className="mt-5 space-y-1">
              <div className="grid grid-cols-12 gap-3 px-3 pb-2 text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">
                <div className="col-span-5">Agente</div>
                <div className="col-span-3 text-right">Conversas</div>
                <div className="col-span-2 text-right">CSAT</div>
                <div className="col-span-2 text-right">Status</div>
              </div>
              {agents.map((a, i) => (
                <div key={a.id} className="grid grid-cols-12 items-center gap-3 rounded-md px-3 py-2 hover:bg-surface-hover transition-colors">
                  <div className="col-span-5 flex items-center gap-2.5">
                    <span className="font-mono text-[10px] text-subtle-foreground w-4">{i + 1}</span>
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary/40 to-channel-instagram/40 text-[10px] font-semibold">
                      {a.initials}
                    </div>
                    <span className="text-sm font-medium">{a.name}</span>
                  </div>
                  <div className="col-span-3 text-right">
                    <div className="inline-flex items-baseline gap-1">
                      <span className="font-mono text-sm">{a.chats}</span>
                      <span className="font-mono text-[10px] text-subtle-foreground">conv</span>
                    </div>
                  </div>
                  <div className="col-span-2 text-right font-mono text-sm">
                    {a.csat == null ? '—' : a.csat}
                    <span className="text-subtle-foreground text-[10px]">{a.csat == null ? '' : '/5'}</span>
                  </div>
                  <div className="col-span-2 flex items-center justify-end gap-1.5">
                    <StatusDot status={a.status} />
                    <span className="text-[10px] capitalize text-muted-foreground">{a.status}</span>
                  </div>
                </div>
              ))}
            </div>

            {isLoading ? <div className="mt-3 text-xs text-muted-foreground">Carregando métricas…</div> : null}
            {isError ? <div className="mt-3 text-xs text-muted-foreground">Sem dados (API indisponível).</div> : null}
            {!isLoading && !isError && agents.length === 0 ? (
              <div className="mt-3 rounded-lg border border-border bg-background/30 px-3 py-2 text-xs text-muted-foreground">
                Sem dados no período.
              </div>
            ) : null}
          </div>
        </div>

        <div className="mt-6 text-[10px] text-subtle-foreground font-mono">
          {data ? `period=${data.period_days}d` : `period=${periodDays}d`} · channels={enabledChannels.join(',')}
        </div>
      </div>
    </div>
  );
}


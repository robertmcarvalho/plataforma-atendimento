'use client';

import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';
import Link from 'next/link';
import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CalendarCheck,
  ClipboardList,
  Clock,
  MessageCircle,
  ShieldCheck,
  TrendingUp,
  Truck,
  UserPlus,
  UserX,
} from 'lucide-react';
import { LeaderPage } from '@/components/leader/LeaderPage';
import { PageHeader } from '@/components/ui/PageHeader';
import { IconTile, type IconTileTone } from '@/components/ui/IconTile';
import { tarefaMeta, tarefaStatusMeta, taskIconOverride } from '@/components/operacao/revive/copy/ReviveTaskCard';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import type { OpsHubTaskRow, OpsSignaturePending } from '@/lib/ops/opsAnalyticsApi';
import { mapTaskRows } from '@/lib/operacao/reviveCopy/hubToReviveModel';
import { slaBarColor } from '@/lib/operacao/operacaoTaskReviveUtils';

type LeaderStats = {
  pharmacies_count: number;
  drivers_count: number;
  pending_absences: number;
  pending_dailies: number;
  open_entries?: number;
  base_revenue: number;
  bonuses: number;
  discounts: number;
  net_estimated: number;
};

type PharmacyRow = { id: string; trade_name: string; status?: string | null };
type DriverRow = { id: string; name: string; leader_linked_pharmacy_ids?: string[] };

const quick: Array<{
  href: string;
  label: string;
  icon: typeof Building2;
  desc: string;
  tone: IconTileTone;
}> = [
  {
    href: '/lider/ocorrencias',
    label: 'Ocorrências e lançamentos',
    icon: UserX,
    desc: 'Falta, folga, diária e acompanhamento até a baixa',
    tone: 'destructive',
  },
  { href: '/lider/pre-cadastro', label: 'Pré-cadastro', icon: UserPlus, desc: 'Novo entregador para aprovação', tone: 'success' },
  { href: '/lider/chat', label: 'Abrir chat', icon: MessageCircle, desc: 'Falar com setor de atendimento', tone: 'warning' },
];

export default function LiderDashboardPage() {
  const user = useAuth((s) => s.user);
  const firstName = user?.name?.trim().split(/\s+/)[0] || 'líder';

  const { data: stats, isLoading } = useQuery<LeaderStats>({
    queryKey: ['leader-portal', 'stats'],
    queryFn: async () => await leaderPortalPageApi.fetchStats() as LeaderStats,
    enabled: user?.role === 'leader',
  });

  const { data: docAlerts = [] } = useQuery<Array<{ id: string; title: string; description?: string | null }>>({
    queryKey: ['leader-portal', 'document-alerts'],
    queryFn: async () => await leaderPortalPageApi.fetchDocumentAlerts(),
    enabled: user?.role === 'leader',
  });

  const { data: pharmacies = [] } = useQuery<PharmacyRow[]>({
    queryKey: ['leader-portal', 'pharmacies'],
    queryFn: async () => await leaderPortalPageApi.fetchPharmacies() as PharmacyRow[],
    enabled: user?.role === 'leader',
  });

  const { data: drivers = [] } = useQuery<DriverRow[]>({
    queryKey: ['leader-portal', 'drivers'],
    queryFn: async () => await leaderPortalPageApi.fetchDrivers() as DriverRow[],
    enabled: user?.role === 'leader',
  });

  const { data: dashboard, isLoading: dashboardLoading } = useQuery<{
    tasks: OpsHubTaskRow[];
    pending_signatures: OpsSignaturePending[];
  }>({
    queryKey: ['leader-portal', 'dashboard'],
    queryFn: async () => await leaderPortalPageApi.fetchDashboard(),
    enabled: user?.role === 'leader',
    refetchInterval: 60_000,
  });

  const driverTasks = useMemo(() => mapTaskRows(dashboard?.tasks || []), [dashboard?.tasks]);
  const pendingSignatures = dashboard?.pending_signatures || [];

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Portal do líder" description="Este painel é exclusivo para perfis de líder." compact />
        <Link className={buttonVariants({ variant: 'secondary' })} href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  const kpis: Array<{
    label: string;
    value: string;
    trend: string;
    icon: typeof Building2;
    tone: IconTileTone;
  }> = [
    {
      label: 'Farmácias ativas',
      value: isLoading ? '…' : String(stats?.pharmacies_count ?? 0),
      trend: 'na sua zona',
      icon: Building2,
      tone: 'primary',
    },
    {
      label: 'Entregadores',
      value: isLoading ? '…' : String(stats?.drivers_count ?? 0),
      trend: `${stats?.drivers_count ?? 0} vinculados`,
      icon: Truck,
      tone: 'success',
    },
    {
      label: 'Lançamentos em aberto',
      value: isLoading ? '…' : String(stats?.open_entries ?? stats?.pending_dailies ?? 0),
      trend: 'faltas, folgas e diárias',
      icon: CalendarCheck,
      tone: 'warning',
    },
    {
      label: 'Faltas aguard. financeiro',
      value: isLoading ? '…' : String(stats?.pending_absences ?? 0),
      trend: 'decisão desconto/abono',
      icon: UserX,
      tone: 'destructive',
    },
  ];

  const alerts = [
    docAlerts.length
      ? {
          tipo: 'Documento',
          texto: `${docAlerts.length} alerta(s) de CNH/certificado`,
          time: 'Hoje',
          tone: 'warning' as const,
          href: '/lider/entregadores',
        }
      : null,
    stats?.open_entries
      ? {
          tipo: 'Em aberto',
          texto: `${stats.open_entries} lançamento(s) em aberto na sua rede`,
          time: 'Hoje',
          tone: 'warning' as const,
          href: '/lider/ocorrencias',
        }
      : null,
    stats?.pending_absences
      ? {
          tipo: 'Falta',
          texto: `${stats.pending_absences} falta(s) aguardando decisão do financeiro`,
          time: 'Hoje',
          tone: 'warning' as const,
        }
      : null,
    stats?.pending_dailies
      ? {
          tipo: 'Diária',
          texto: `${stats.pending_dailies} diária(s) aguardando aprovação do financeiro`,
          time: 'Hoje',
          tone: 'warning' as const,
          href: '/lider/ocorrencias',
        }
      : null,
  ].filter(Boolean) as Array<{ tipo: string; texto: string; time: string; tone: 'warning'; href?: string }>;

  const scaleRows = pharmacies.slice(0, 6).map((p) => {
    const linked = drivers.filter((d) => (d.leader_linked_pharmacy_ids || []).includes(p.id)).length;
    return { id: p.id, name: p.trade_name, expected: linked, ok: linked };
  });

  return (
    <LeaderPage>
      <PageHeader
        icon={ShieldCheck}
        eyebrow="Painel do líder"
        title={`Bom dia, ${firstName}`}
        description="Acompanhe sua zona, ocorrências de escala e a operação do dia."
        actions={
          <button
            type="button"
            className="relative rounded-md border border-border p-2 transition-colors hover:bg-sidebar-accent/60"
            title="Notificações"
          >
            <Bell className="h-4 w-4" />
            {alerts.length || docAlerts.length ? (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
            ) : null}
          </button>
        }
      />

      <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{k.label}</span>
              <IconTile icon={k.icon} tone={k.tone} size="sm" />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{k.value}</div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <TrendingUp className="h-3 w-3" /> {k.trend}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-8">
        <h3 className="mb-3 text-sm font-semibold">Ações rápidas</h3>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {quick.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="group rounded-xl border border-border bg-card p-4 transition-all hover:border-primary/40"
            >
              <IconTile icon={q.icon} tone={q.tone} />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-medium">{q.label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{q.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <IconTile icon={ClipboardList} tone="primary" size="sm" /> Tarefas dos meus entregadores
          </h3>
          <span className="text-[10px] text-muted-foreground">Acompanhe o status sem precisar acionar atendimento.</span>
        </div>
        {dashboardLoading ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Carregando tarefas…</div>
        ) : driverTasks.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Nenhuma tarefa em aberto.</div>
        ) : (
          <ul className="grid grid-cols-1 gap-2 md:grid-cols-2">
            {driverTasks.map((t) => {
              const meta = tarefaMeta[t.tipo];
              const Icon = taskIconOverride[t.tipo] ?? meta.icon;
              const pct = Math.min(100, Math.round((t.decorridoMinutos / Math.max(t.slaMinutos, 1)) * 100));
              return (
                <li
                  key={t.id}
                  className={cn(
                    'rounded-lg border bg-background/40 p-3',
                    t.status === 'atrasada' ? 'border-destructive/40' : 'border-border'
                  )}
                >
                  <div className="flex items-start gap-2.5">
                    <IconTile icon={Icon} tone={meta.tone} size="sm" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{meta.label}</div>
                      <div className="truncate text-xs font-semibold">{t.entregadorNome}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {t.farmacia} · prazo {t.prazo}
                      </div>
                    </div>
                    <span className={cn('rounded border px-1.5 py-0.5 text-[9px] font-medium', tarefaStatusMeta[t.status].cls)}>
                      {tarefaStatusMeta[t.status].label}
                    </span>
                  </div>
                  <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                    <div className={cn('h-full', slaBarColor(t.status, pct))} style={{ width: `${pct}%` }} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="mb-8 rounded-xl border border-border bg-card p-5">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <IconTile icon={AlertTriangle} tone="warning" size="sm" /> Assinaturas pendentes da minha equipe
        </h3>
        {dashboardLoading ? (
          <div className="py-4 text-center text-xs text-muted-foreground">Carregando assinaturas…</div>
        ) : pendingSignatures.length === 0 ? (
          <div className="py-4 text-center text-xs text-muted-foreground">Nenhuma assinatura pendente no momento.</div>
        ) : (
          <ul className="space-y-2">
            {pendingSignatures.map((n) => {
              const atrasada = n.days_pending > n.deadline_days;
              return (
                <li
                  key={n.id}
                  className={cn(
                    'flex items-center gap-2 rounded-lg border bg-background/40 p-2.5',
                    atrasada ? 'border-destructive/40' : 'border-border'
                  )}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary to-channel-instagram text-[10px] font-semibold text-primary-foreground">
                    {n.driver_initials}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">{n.driver_name}</div>
                    <div className="text-[10px] text-muted-foreground">
                      {n.type === 'matricula' ? 'Matrícula' : 'Termo de desligamento'} · {n.pharmacy_name}
                    </div>
                  </div>
                  <span
                    className={cn(
                      'rounded px-1.5 py-0.5 font-mono text-[10px]',
                      atrasada ? 'bg-destructive/15 text-destructive' : 'bg-warning/15 text-warning'
                    )}
                  >
                    {n.days_pending}/{n.deadline_days}d
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <IconTile icon={AlertTriangle} tone="warning" size="sm" /> Alertas operacionais
            </h3>
            <span className="text-[10px] text-muted-foreground">{alerts.length ? `${alerts.length} novo(s)` : 'Sem alertas'}</span>
          </div>
          {alerts.length ? (
            <ul className="space-y-2">
              {alerts.map((a, i) => (
                <li key={i} className="flex items-start gap-3 rounded-lg border border-border bg-background/40 p-3">
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-warning" />
                  <div className="flex-1">
                    <div className="text-xs font-medium">{a.tipo}</div>
                    <div className="text-xs text-muted-foreground">{a.texto}</div>
                    {a.href ? (
                      <Link href={a.href} className="mt-1 inline-block text-[10px] text-primary hover:underline">
                        Ver entregadores
                      </Link>
                    ) : null}
                  </div>
                  <span className="flex items-center gap-1 text-[10px] text-subtle-foreground">
                    <Clock className="h-3 w-3" />
                    {a.time}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <div className="rounded-lg border border-border bg-background/40 p-4 text-xs text-muted-foreground">
              Nenhum alerta no momento.
            </div>
          )}
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
            <IconTile icon={CalendarCheck} tone="primary" size="sm" /> Escala de hoje
          </h3>
          <div className="space-y-2">
            {scaleRows.length ? (
              scaleRows.map((r) => (
                <div key={r.id} className="flex items-center justify-between rounded-lg border border-border bg-background/40 p-3">
                  <div className="flex items-center gap-2">
                    <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs">{r.name}</span>
                  </div>
                  <span className={cn('font-mono text-xs', r.ok < r.expected ? 'text-warning' : 'text-success')}>
                    {r.ok}/{r.expected}
                  </span>
                </div>
              ))
            ) : (
              <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground">
                Nenhuma farmácia vinculada. Configure vínculos em{' '}
                <Link className="text-primary hover:underline" href="/lider/farmacias">
                  Minhas farmácias
                </Link>
                .
              </div>
            )}
          </div>
        </div>
      </div>
    </LeaderPage>
  );
}

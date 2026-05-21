'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  Building2,
  CalendarCheck,
  Clock,
  MessageCircle,
  Truck,
  UserPlus,
  UserX,
} from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/store/auth';

type LeaderStats = {
  pharmacies_count: number;
  drivers_count: number;
  pending_absences: number;
  pending_dailies: number;
  base_revenue: number;
  bonuses: number;
  discounts: number;
  net_estimated: number;
};

const quick = [
  { href: '/lider/diarias', label: 'Lançar diária', icon: CalendarCheck, desc: 'Registrar entregadores em campo hoje' },
  { href: '/lider/faltas', label: 'Registrar falta', icon: UserX, desc: 'Comunicar ausência de entregador' },
  { href: '/lider/pre-cadastro', label: 'Pré-cadastro', icon: UserPlus, desc: 'Novo entregador para aprovação' },
  { href: '/lider/chat', label: 'Abrir chat', icon: MessageCircle, desc: 'Falar com setor de atendimento' },
];

export default function LiderDashboardPage() {
  const user = useAuth((s) => s.user);
  const firstName = user?.name?.trim().split(/\s+/)[0] || 'líder';

  const { data: stats, isLoading } = useQuery<LeaderStats>({
    queryKey: ['leader-portal', 'stats'],
    queryFn: async () => (await api.get('/api/leader-portal/stats')).data as LeaderStats,
    enabled: user?.role === 'leader',
  });

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Portal do líder" description="Este painel é exclusivo para perfis de líder." compact />
        <Link className="button-secondary" href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  const kpis = [
    {
      label: 'Farmácias ativas',
      value: isLoading ? '…' : String(stats?.pharmacies_count ?? 0),
      trend: 'na sua zona',
      icon: Building2,
      color: 'text-primary',
    },
    {
      label: 'Entregadores',
      value: isLoading ? '…' : String(stats?.drivers_count ?? 0),
      trend: `${stats?.drivers_count ?? 0} vinculados`,
      icon: Truck,
      color: 'text-success',
    },
    {
      label: 'Diárias pendentes',
      value: isLoading ? '…' : String(stats?.pending_dailies ?? 0),
      trend: 'aguardando aprovação',
      icon: CalendarCheck,
      color: 'text-warning',
    },
    {
      label: 'Faltas pendentes',
      value: isLoading ? '…' : String(stats?.pending_absences ?? 0),
      trend: 'aguardando aprovação',
      icon: UserX,
      color: 'text-destructive',
    },
  ];

  const alerts = [
    stats?.pending_absences ? { tipo: 'Falta', texto: `${stats.pending_absences} falta(s) pendente(s)`, time: 'Hoje', tone: 'warning' as const } : null,
    stats?.pending_dailies ? { tipo: 'Diária', texto: `${stats.pending_dailies} diária(s) pendente(s)`, time: 'Hoje', tone: 'warning' as const } : null,
  ].filter(Boolean) as Array<{ tipo: string; texto: string; time: string; tone: 'warning' }>;

  return (
    <div className="p-8 max-w-7xl">
      <PageHeader
        eyebrow="Painel do líder"
        title={`Bom dia, ${firstName}`}
        description="Acompanhe sua zona, lance diárias e cuide da operação do dia."
        actions={
          <button type="button" className="relative rounded-md border border-border p-2 hover:bg-surface-hover" title="Notificações">
            <Bell className="h-4 w-4" />
            {(alerts.length || 0) > 0 ? (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-destructive" />
            ) : null}
          </button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{k.label}</span>
              <k.icon className={`h-4 w-4 ${k.color}`} />
            </div>
            <div className="mt-2 text-2xl font-semibold tracking-tight">{k.value}</div>
            <div className="mt-1 flex items-center gap-1 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {k.trend}
            </div>
          </div>
        ))}
      </div>

      <div className="mb-8">
        <h3 className="mb-3 text-sm font-semibold">Ações rápidas</h3>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {quick.map((q) => (
            <Link
              key={q.href}
              href={q.href}
              className="group rounded-xl border border-border bg-card p-4 hover:border-primary/40 transition-all"
            >
              <q.icon className="h-5 w-5 text-primary" />
              <div className="mt-3 flex items-center justify-between">
                <span className="text-sm font-medium">{q.label}</span>
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">{q.desc}</p>
            </Link>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-warning" /> Alertas operacionais
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
                  </div>
                  <span className="text-[10px] text-subtle-foreground flex items-center gap-1">
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
          <h3 className="text-sm font-semibold mb-3">Escala de hoje</h3>
          <div className="space-y-2">
            <div className="rounded-lg border border-border bg-background/40 p-3 text-xs text-muted-foreground">
              Dica: atualize as escalas na aba <Link className="text-primary hover:underline" href="/lider/entregadores">Entregadores</Link>.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

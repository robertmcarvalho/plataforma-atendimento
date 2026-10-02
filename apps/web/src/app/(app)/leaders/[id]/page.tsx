'use client';

import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';

import { useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Building2, ChevronRight, Crown, Edit3, Mail, MapPin, Phone } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { StatusDot } from '@/components/ui/StatusDot';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatBrazilPhone } from '@/lib/brFormat';
import { cadastroStatusDot } from '@/lib/cadastroStatus';

type LeaderStatus = 'active' | 'inactive';

type LeaderDetailResponse = {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  status: LeaderStatus;
  leader_pharmacy_links?: Array<{
    id: string;
    is_active: boolean;
    pharmacies?: { id: string; trade_name: string; city: string | null; state?: string | null } | null;
  }>;
  pharmacies_with_drivers?: Array<{
    pharmacy_id: string;
    trade_name: string;
    city: string | null;
    drivers: Array<{ id: string; name: string; phone: string; is_primary: boolean; status?: string }>;
  }>;
};

function initials(input: string) {
  const trimmed = (input || '').trim();
  if (!trimmed) return '??';
  return trimmed
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');
}

const DRIVER_STATUS_LABEL: Record<string, string> = {
  active: 'Disponível',
  blocked: 'Em rota',
  inactive: 'Pausa',
};

function driverStatusTone(status: string | undefined): 'success' | 'warning' | 'neutral' | 'muted' {
  const s = String(status || 'active');
  if (s === 'active') return 'success';
  if (s === 'blocked') return 'warning';
  if (s === 'inactive') return 'neutral';
  return 'muted';
}

export default function LeaderFichaPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id || '';

  const leaderQuery = useQuery<LeaderDetailResponse>({
    queryKey: ['leader-ficha', id],
    enabled: Boolean(id),
    queryFn: async () => await cadastroPageApi.fetchLeader(id) as LeaderDetailResponse,
  });

  const leader = leaderQuery.data;

  const pharmacies = useMemo(() => {
    const links = leader?.leader_pharmacy_links || [];
    const rows = links
      .filter((l) => l.is_active && l.pharmacies?.id)
      .map((l) => l.pharmacies!)
      .filter(Boolean);
    const seen = new Set<string>();
    return rows.filter((p) => {
      if (seen.has(p.id)) return false;
      seen.add(p.id);
      return true;
    });
  }, [leader?.leader_pharmacy_links]);

  const pharmaciesWithDrivers = leader?.pharmacies_with_drivers || [];
  const activeDriversTotal = pharmaciesWithDrivers.reduce((acc, p) => acc + (p.drivers?.length || 0), 0);

  const regiao = useMemo(() => {
    if (!leader) return '—';
    const parts = [leader.city, leader.state].filter(Boolean);
    return parts.length ? parts.join(' / ') : '—';
  }, [leader]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <Link
          href="/leaders"
          className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> Voltar para líderes
        </Link>

        <PageHeader
          icon={Crown}
          eyebrow="Pessoas · Ficha"
          title="Ficha do líder"
          description="Visão consolidada do líder, farmácias e equipe ativa."
          actions={
            leader ? (
              <Link href={`/leaders/new?id=${encodeURIComponent(leader.id)}`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <Edit3 className="h-3.5 w-3.5" /> Editar
              </Link>
            ) : null
          }
        />

        {leaderQuery.isLoading ? (
          <div className="text-sm text-muted-foreground">Carregando…</div>
        ) : leaderQuery.isError || !leader ? (
          <div className="text-sm text-destructive">Não foi possível carregar a ficha do líder.</div>
        ) : (
          <>
            <section className="mb-5 rounded-xl border border-border bg-surface p-6">
              <div className="flex flex-wrap items-start gap-4">
                <div className="relative shrink-0">
                  <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-primary text-lg font-semibold text-primary-foreground">
                    {initials(leader.name)}
                  </div>
                  <div className="absolute -top-1 -right-1 flex h-6 w-6 items-center justify-center rounded-full bg-warning text-warning-foreground">
                    <Crown className="h-3.5 w-3.5" />
                  </div>
                  <StatusDot status={cadastroStatusDot(leader.status)} pulse={leader.status === 'active'} className="absolute -bottom-0.5 -right-0.5" />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-3">
                    <h2 className="text-lg font-semibold">{leader.name}</h2>
                    <span
                      className={cn(
                        'rounded px-2 py-0.5 text-[10px] font-medium',
                        leader.status === 'active' ? 'bg-success/15 text-success' : 'bg-muted/50 text-subtle-foreground',
                      )}
                    >
                      {leader.status === 'active' ? 'Online' : 'Offline'}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1.5 text-xs text-muted-foreground">
                    {leader.email ? (
                      <span className="inline-flex items-center gap-1.5 min-w-0">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{leader.email}</span>
                      </span>
                    ) : null}
                    <span className="inline-flex items-center gap-1.5 font-mono">
                      <Phone className="h-3 w-3" /> {formatBrazilPhone(leader.phone) || leader.phone}
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" /> {regiao}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 border-l border-border pl-6">
                  <div>
                    <div className="font-mono text-2xl font-semibold">{pharmacies.length}</div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Farmácias</div>
                  </div>
                  <div>
                    <div className="font-mono text-2xl font-semibold text-success">{activeDriversTotal}</div>
                    <div className="text-[10px] uppercase tracking-wider text-subtle-foreground">Entregadores</div>
                  </div>
                </div>
              </div>
            </section>

            <section className="mb-5 rounded-xl border border-border bg-surface p-5">
              <h3 className="mb-3 text-sm font-semibold">Farmácias vinculadas</h3>
              {pharmacies.length === 0 ? (
                <div className="text-xs text-muted-foreground">Nenhuma farmácia vinculada.</div>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {pharmacies.map((p) => {
                    const driverCount =
                      pharmaciesWithDrivers.find((row) => row.pharmacy_id === p.id)?.drivers.length ?? 0;
                    const cityLine = [p.city, p.state].filter(Boolean).join(' / ') || '—';
                    return (
                      <Link
                        key={p.id}
                        href={`/pharmacies/${p.id}`}
                        className="group flex items-center gap-3 rounded-lg border border-border bg-background p-3 transition-colors hover:border-primary/40 hover:bg-sidebar-accent/40"
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-gradient-primary text-primary-foreground">
                          <Building2 className="h-4.5 w-4.5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{p.trade_name}</div>
                          <div className="font-mono text-[10px] text-subtle-foreground">{cityLine}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-mono text-sm font-semibold text-success">{driverCount}</div>
                          <div className="text-[9px] uppercase text-subtle-foreground">ativos</div>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground group-hover:text-foreground" />
                      </Link>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="rounded-xl border border-border bg-surface p-5">
              <h3 className="mb-4 text-sm font-semibold">Entregadores ativos por farmácia</h3>
              {pharmaciesWithDrivers.length === 0 ? (
                <div className="text-xs text-muted-foreground">Nenhuma informação disponível.</div>
              ) : (
                <div className="space-y-4">
                  {pharmaciesWithDrivers.map((p) => (
                    <div key={p.pharmacy_id}>
                      <div className="mb-2 flex items-center gap-2">
                        <Building2 className="h-3.5 w-3.5 text-primary" />
                        <span className="text-xs font-semibold">{p.trade_name}</span>
                        <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                          {p.drivers.length}
                        </span>
                      </div>
                      <div className="overflow-hidden rounded-md border border-border">
                        <table className="w-full text-xs">
                          <thead className="bg-background">
                            <tr className="text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
                              <th className="px-3 py-2">Entregador</th>
                              <th className="px-3 py-2">Telefone</th>
                              <th className="px-3 py-2">Status</th>
                            </tr>
                          </thead>
                          <tbody>
                            {p.drivers.map((d) => {
                              const tone = driverStatusTone(d.status);
                              return (
                                <tr key={d.id} className="border-t border-border/60">
                                  <td className="px-3 py-2">
                                    <Link href={`/drivers/${d.id}`} className="flex items-center gap-2 hover:underline">
                                      <div className="relative">
                                        <div className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp/40 to-primary/40 text-[10px] font-semibold">
                                          {initials(d.name)}
                                        </div>
                                        <StatusDot status={cadastroStatusDot(d.status)} className="absolute -bottom-0.5 -right-0.5" />
                                      </div>
                                      <span className="font-medium">{d.name}</span>
                                    </Link>
                                  </td>
                                  <td className="px-3 py-2 font-mono text-muted-foreground">{formatBrazilPhone(d.phone) || d.phone}</td>
                                  <td className="px-3 py-2">
                                    <span
                                      className={cn(
                                        'rounded px-2 py-0.5 text-[10px] font-medium',
                                        tone === 'success' && 'bg-success/15 text-success',
                                        tone === 'warning' && 'bg-warning/15 text-warning',
                                        tone === 'neutral' && 'bg-muted text-muted-foreground',
                                        tone === 'muted' && 'bg-muted/50 text-subtle-foreground',
                                      )}
                                    >
                                      {DRIVER_STATUS_LABEL[d.status || 'active'] || 'Disponível'}
                                    </span>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  );
}

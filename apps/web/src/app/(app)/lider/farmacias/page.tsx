'use client';

import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, Clock, Mail, MapPin, Phone, Search, User } from 'lucide-react';
import { LeaderPage } from '@/components/leader/LeaderPage';
import { LeaderMasterDetailLayout } from '@/components/leader/LeaderMasterDetailLayout';
import { PageHeader } from '@/components/ui/PageHeader';
import { LeaderDetailField } from '@/components/leader/LeaderDetailField';
import { useIsLgUp } from '@/hooks/useMediaQuery';
import { formatWorkScheduleSummary, hasConfiguredWorkSchedule } from '@/components/settings/BusinessHoursEditor';
import {
  interactiveRowPrimary,
  interactiveRowSecondary,
  interactiveRowSurface,
} from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { useAuth } from '@/store/auth';
import { formatBrazilPhone } from '@/lib/brFormat';

type Pharmacy = {
  id: string;
  trade_name: string;
  legal_name?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  status?: string | null;
  address_street?: string | null;
  address_number?: string | null;
  address_neighborhood?: string | null;
};

type Driver = {
  id: string;
  name: string;
  phone?: string | null;
  driver_type?: 'fixed' | 'daily' | null;
  work_schedule?: Record<string, unknown> | null;
  leader_linked_pharmacy_ids?: string[];
};

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0]!.toUpperCase())
      .join('') || '??'
  );
}

export default function LiderFarmaciasPage() {
  const user = useAuth((s) => s.user);
  const isLgUp = useIsLgUp();
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pharmaciesQuery = useQuery<Pharmacy[]>({
    queryKey: ['leader-portal', 'pharmacies'],
    queryFn: async () => await leaderPortalPageApi.fetchPharmacies() as Pharmacy[],
    enabled: user?.role === 'leader',
  });

  const driversQuery = useQuery<Driver[]>({
    queryKey: ['leader-portal', 'drivers'],
    queryFn: async () => await leaderPortalPageApi.fetchDrivers() as Driver[],
    enabled: user?.role === 'leader',
  });

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rows = pharmaciesQuery.data || [];
    if (!query) return rows;
    return rows.filter((p) => (p.trade_name || '').toLowerCase().includes(query));
  }, [pharmaciesQuery.data, q]);

  const selected = useMemo(() => {
    const rows = pharmaciesQuery.data || [];
    const id = selectedId ?? (isLgUp ? rows[0]?.id : null) ?? null;
    return rows.find((p) => p.id === id) || null;
  }, [pharmaciesQuery.data, selectedId, isLgUp]);

  const team = useMemo(() => {
    const pharmacyId = selected?.id;
    if (!pharmacyId) return [];
    const rows = driversQuery.data || [];
    return rows.filter((d) => (d.leader_linked_pharmacy_ids || []).includes(pharmacyId));
  }, [driversQuery.data, selected?.id]);

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Minhas farmácias" description="Esta área é exclusiva para perfis de líder." compact />
        <Link className={buttonVariants({ variant: 'secondary' })} href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  const listPanel = (
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <FormControl
                inputSize="sm"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar farmácia..."
                className="pl-8"
              />
            </div>
          </div>
          <ul className="divide-y divide-border">
            {pharmaciesQuery.isLoading ? (
              <li className="p-4 text-sm text-muted-foreground">Carregando…</li>
            ) : list.length === 0 ? (
              <li className="p-4 text-sm text-muted-foreground">Nenhuma farmácia encontrada.</li>
            ) : (
              list.map((p) => {
                const active = selected?.id === p.id;
                const status = (p.status || 'active') === 'active' ? 'ativa' : 'inativa';
                return (
                  <li key={p.id}>
                    <button
                      onClick={() => setSelectedId(p.id)}
                      className={cn('flex w-full items-center gap-3 p-3 text-left', interactiveRowSurface(active))}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className={cn('truncate text-xs font-medium', interactiveRowPrimary(active))}>{p.trade_name}</span>
                          <span className={cn('h-1.5 w-1.5 rounded-full', status === 'ativa' ? 'bg-success' : 'bg-muted-foreground')} />
                        </div>
                        <div className={cn('truncate text-[10px]', interactiveRowSecondary(active))}>
                          {(p.city || '—') + (p.state ? ` / ${p.state}` : '')}
                        </div>
                      </div>
                      <ChevronRight className={cn('h-3.5 w-3.5 shrink-0', interactiveRowSecondary(active))} />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
  );

  const detailPanel = (
        <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
          {!selected ? (
            <div className="text-sm text-muted-foreground">Selecione uma farmácia…</div>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-channel-instagram text-primary-foreground">
                    <Building2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">{selected.trade_name}</h2>
                    <span className="text-xs text-muted-foreground">ID #{selected.id.slice(0, 8)} · {team.length} entregadores</span>
                  </div>
                </div>
                <span
                  className={cn(
                    'rounded-full border px-2 py-0.5 text-[10px]',
                    (selected.status || 'active') === 'active'
                      ? 'border-success/40 text-success bg-success/10'
                      : 'border-warning/40 text-warning bg-warning/10'
                  )}
                >
                  {(selected.status || 'active') === 'active' ? 'Operando' : 'Inativa'}
                </span>
              </div>

              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <LeaderDetailField
                  icon={MapPin}
                  label="Endereço"
                  value={[selected.address_street, selected.address_number, selected.address_neighborhood].filter(Boolean).join(', ') || null}
                />
                <LeaderDetailField icon={Phone} label="Telefone" value={formatBrazilPhone(selected.phone || '') || null} />
                <LeaderDetailField icon={Mail} label="E-mail" value={selected.email || null} />
                <LeaderDetailField icon={User} label="Razão social" value={selected.legal_name || null} />
                <LeaderDetailField icon={Clock} label="Cidade" value={(selected.city || '—') + (selected.state ? ` / ${selected.state}` : '')} />
                <LeaderDetailField icon={Building2} label="CNPJ" value={selected.cnpj || null} />
              </div>

              <div className="mt-6 border-t border-border pt-5">
                <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Equipe vinculada</h4>
                {driversQuery.isLoading ? (
                  <div className="text-xs text-muted-foreground">Carregando entregadores…</div>
                ) : team.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Nenhum entregador ativo vinculado.</div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {team.slice(0, 30).map((d) => (
                      <div
                        key={d.id}
                        className="flex items-center gap-2 rounded-full border border-border bg-background/40 px-3 py-1"
                        title={
                          hasConfiguredWorkSchedule(d.work_schedule)
                            ? formatWorkScheduleSummary(d.work_schedule)
                            : 'Escala não configurada'
                        }
                      >
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-primary to-channel-instagram text-[10px] text-primary-foreground">
                          {initials(d.name)}
                        </div>
                        <span className="text-xs">{d.name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
  );

  return (
    <LeaderPage fullHeight className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow="Cadastros"
        title="Minhas farmácias"
        description="Farmácias vinculadas à sua zona. Abra a ficha para ver os dados completos."
      />

      <LeaderMasterDetailLayout
        className="min-h-0 flex-1"
        list={listPanel}
        detail={detailPanel}
        hasSelection={Boolean(selectedId)}
        onBack={() => setSelectedId(null)}
        detailTitle={selected?.trade_name}
      />
    </LeaderPage>
  );
}

'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Building2, ChevronRight, Clock, Mail, MapPin, Phone, Search, User } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatWorkScheduleSummary, hasConfiguredWorkSchedule } from '@/components/settings/BusinessHoursEditor';
import { cn } from '@/lib/utils';
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
  work_schedule?: any | null;
  leader_linked_pharmacy_ids?: string[];
};

function Field({ icon: Icon, label, value }: { icon: any; label: string; value?: string | null }) {
  const shown = value && String(value).trim() ? String(value) : '—';
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <Icon className="h-3 w-3" /> {label}
      </div>
      <div className="mt-1 text-sm">{shown}</div>
    </div>
  );
}

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
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const pharmaciesQuery = useQuery<Pharmacy[]>({
    queryKey: ['leader-portal', 'pharmacies'],
    queryFn: async () => (await api.get('/api/leader-portal/pharmacies')).data as Pharmacy[],
    enabled: user?.role === 'leader',
  });

  const driversQuery = useQuery<Driver[]>({
    queryKey: ['leader-portal', 'drivers'],
    queryFn: async () => (await api.get('/api/leader-portal/drivers')).data as Driver[],
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
    const id = selectedId || rows[0]?.id || null;
    return rows.find((p) => p.id === id) || null;
  }, [pharmaciesQuery.data, selectedId]);

  const team = useMemo(() => {
    if (!selected?.id) return [];
    const rows = driversQuery.data || [];
    return rows.filter((d) => (d.leader_linked_pharmacy_ids || []).includes(selected.id));
  }, [driversQuery.data, selected?.id]);

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Minhas farmácias" description="Esta área é exclusiva para perfis de líder." compact />
        <Link className="button-secondary" href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl">
      <PageHeader
        eyebrow="Cadastros"
        title="Minhas farmácias"
        description="Farmácias vinculadas à sua zona. Abra a ficha para ver os dados completos."
      />

      <div className="grid lg:grid-cols-[360px_1fr] gap-4">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar farmácia..."
                className="w-full rounded-md border border-border bg-background/40 pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-primary/50"
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
                      className={cn(
                        'w-full flex items-center gap-3 p-3 text-left hover:bg-surface-hover transition-colors',
                        active && 'bg-surface-hover'
                      )}
                    >
                      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                        <Building2 className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium truncate">{p.trade_name}</span>
                          <span className={cn('h-1.5 w-1.5 rounded-full', status === 'ativa' ? 'bg-success' : 'bg-muted-foreground')} />
                        </div>
                        <div className="text-[10px] text-muted-foreground truncate">
                          {(p.city || '—') + (p.state ? ` / ${p.state}` : '')}
                        </div>
                      </div>
                      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>

        <div className="rounded-xl border border-border bg-card p-6">
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
                      : 'border-muted text-muted-foreground bg-muted/30'
                  )}
                >
                  {(selected.status || 'active') === 'active' ? 'Operando' : 'Inativa'}
                </span>
              </div>

              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <Field
                  icon={MapPin}
                  label="Endereço"
                  value={[selected.address_street, selected.address_number, selected.address_neighborhood].filter(Boolean).join(', ') || null}
                />
                <Field icon={Phone} label="Telefone" value={formatBrazilPhone(selected.phone || '') || null} />
                <Field icon={Mail} label="E-mail" value={selected.email || null} />
                <Field icon={User} label="Razão social" value={selected.legal_name || null} />
                <Field icon={Clock} label="Cidade" value={(selected.city || '—') + (selected.state ? ` / ${selected.state}` : '')} />
                <Field icon={Building2} label="CNPJ" value={selected.cnpj || null} />
              </div>

              <div className="mt-6 border-t border-border pt-5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Equipe vinculada</h4>
                {driversQuery.isLoading ? (
                  <div className="text-xs text-muted-foreground">Carregando entregadores…</div>
                ) : team.length === 0 ? (
                  <div className="text-xs text-muted-foreground">Nenhum entregador ativo vinculado.</div>
                ) : (
                  <div className="space-y-2">
                    {team.slice(0, 30).map((d) => {
                      const scheduleSummary = formatWorkScheduleSummary(d.work_schedule);
                      const hasSchedule = hasConfiguredWorkSchedule(d.work_schedule);
                      const typeLabel = d.driver_type === 'daily' ? 'Diarista' : 'Fixo';
                      return (
                        <div key={d.id} className="flex items-start justify-between gap-3 rounded-xl border border-border bg-background/40 px-4 py-3">
                          <div className="flex items-start gap-3 min-w-0">
                            <div className="h-9 w-9 shrink-0 rounded-xl bg-gradient-to-br from-primary to-channel-instagram text-xs flex items-center justify-center text-primary-foreground">
                              {initials(d.name)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-sm font-medium truncate">{d.name}</span>
                                <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
                                  {typeLabel}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[11px] text-muted-foreground">
                                <span className="font-medium text-subtle-foreground">Escala: </span>
                                {hasSchedule ? scheduleSummary : 'Não configurada'}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

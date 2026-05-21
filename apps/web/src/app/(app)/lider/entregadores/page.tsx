'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, Building2, ChevronRight, Mail, MapPin, Phone, Search, Shield, Star, Truck } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { BusinessHoursEditor, serializeWorkScheduleForApi } from '@/components/settings/BusinessHoursEditor';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { formatBrazilPhone } from '@/lib/brFormat';

type Driver = {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  status?: string | null;
  work_schedule?: any | null;
  primary_pharmacy?: { trade_name: string } | null;
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

export default function LiderEntregadoresPage() {
  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [scheduleDraft, setScheduleDraft] = useState<any | null>(null);

  const driversQuery = useQuery<Driver[]>({
    queryKey: ['leader-portal', 'drivers'],
    queryFn: async () => (await api.get('/api/leader-portal/drivers')).data as Driver[],
    enabled: user?.role === 'leader',
  });

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rows = driversQuery.data || [];
    if (!query) return rows;
    return rows.filter((d) => (d.name || '').toLowerCase().includes(query) || (d.primary_pharmacy?.trade_name || '').toLowerCase().includes(query));
  }, [driversQuery.data, q]);

  const selected = useMemo(() => {
    const rows = driversQuery.data || [];
    const id = selectedId || rows[0]?.id || null;
    return rows.find((d) => d.id === id) || null;
  }, [driversQuery.data, selectedId]);

  const saveScheduleMutation = useMutation({
    mutationFn: async (payload: { driverId: string; work_schedule: any }) => {
      const res = await api.patch(`/api/leader-portal/drivers/${payload.driverId}/schedule`, {
        work_schedule: payload.work_schedule,
      });
      return res.data;
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['leader-portal', 'drivers'] });
    },
  });

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Meus entregadores" description="Esta área é exclusiva para perfis de líder." compact />
        <Link className="button-secondary" href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl">
      <PageHeader eyebrow="Cadastros" title="Meus entregadores" description="Equipe vinculada à sua liderança." />

      <div className="grid lg:grid-cols-[360px_1fr] gap-4">
        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border p-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar entregador..."
                className="w-full rounded-md border border-border bg-background/40 pl-8 pr-3 py-2 text-xs focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>
          <ul className="divide-y divide-border">
            {driversQuery.isLoading ? (
              <li className="p-4 text-sm text-muted-foreground">Carregando…</li>
            ) : list.length === 0 ? (
              <li className="p-4 text-sm text-muted-foreground">Nenhum entregador encontrado.</li>
            ) : (
              list.map((d) => {
                const active = selected?.id === d.id;
                const ok = (d.status || 'active') === 'active';
                return (
                  <li key={d.id}>
                    <button
                      onClick={() => {
                        setSelectedId(d.id);
                        setScheduleDraft(d.work_schedule || null);
                      }}
                      className={cn('w-full flex items-center gap-3 p-3 text-left hover:bg-surface-hover', active && 'bg-surface-hover')}
                    >
                      <div className="relative">
                        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-channel-instagram text-xs font-semibold text-primary-foreground">
                          {initials(d.name)}
                        </div>
                        <span
                          className={cn(
                            'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
                            ok ? 'bg-success' : 'bg-muted-foreground'
                          )}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{d.name}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{d.primary_pharmacy?.trade_name || 'Sem farmácia primária'}</div>
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
            <div className="text-sm text-muted-foreground">Selecione um entregador…</div>
          ) : (
            <>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-4">
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gradient-to-br from-primary to-channel-instagram text-base font-semibold text-primary-foreground">
                    {initials(selected.name)}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">{selected.name}</h2>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground mt-0.5">
                      <span className="flex items-center gap-1">
                        <Star className="h-3 w-3 text-warning fill-warning" /> —
                      </span>
                      <span>· {selected.primary_pharmacy?.trade_name || 'Sem vínculo primário'}</span>
                    </div>
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
                  {(selected.status || 'active') === 'active' ? 'ativo' : 'inativo'}
                </span>
              </div>

              <div className="mt-6 grid sm:grid-cols-2 gap-4">
                <Field icon={Phone} label="Telefone" value={formatBrazilPhone(selected.phone || '') || null} />
                <Field icon={Mail} label="E-mail" value={selected.email || null} />
                <Field icon={MapPin} label="Cidade" value={(selected.city || '—') + (selected.state ? ` / ${selected.state}` : '')} />
                <Field icon={Truck} label="Vínculo" value={selected.primary_pharmacy?.trade_name || null} />
                <Field icon={Bike} label="Veículo" value={null} />
                <Field icon={Shield} label="Documentos" value={null} />
              </div>

              <div className="mt-6 border-t border-border pt-5">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Escala</h4>
                <div className="rounded-xl border border-border bg-background/30 p-3">
                  <BusinessHoursEditor value={scheduleDraft || selected.work_schedule || {}} onChange={setScheduleDraft} />
                  <div className="mt-3 flex justify-end">
                    <button
                      type="button"
                      className="button-primary disabled:opacity-50"
                      disabled={saveScheduleMutation.isPending}
                      onClick={() => {
                        void saveScheduleMutation.mutateAsync({
                          driverId: selected.id,
                          work_schedule: serializeWorkScheduleForApi(scheduleDraft || selected.work_schedule || {}),
                        });
                      }}
                    >
                      {saveScheduleMutation.isPending ? 'Salvando…' : 'Salvar escala'}
                    </button>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}


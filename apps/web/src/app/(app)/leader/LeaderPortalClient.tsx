'use client';

import { useState, useMemo, useEffect, type ComponentType } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Building2,
  Users,
  AlertCircle,
  Calendar,
  Clock,
  Package,
  ChevronRight,
  Search,
  ShieldCheck,
  type LucideProps,
} from 'lucide-react';
import { FormControl } from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import {
  interactiveRowPrimary,
  interactiveRowSecondary,
  interactiveRowSurface,
} from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { brFieldClassName } from '@/components/form/BrInputs';
import { PageHeader } from '@/components/ui/PageHeader';
import { IconTile } from '@/components/ui/IconTile';
import { formatDateBr } from '@/lib/datetimeBr';
import { BusinessHoursEditor, serializeWorkScheduleForApi } from '@/components/settings/BusinessHoursEditor';
import { formatBrazilPhone } from '@/lib/brFormat';

interface LeaderStats {
  pharmacies_count: number;
  drivers_count: number;
  pending_absences: number;
  pending_dailies: number;
  base_revenue: number;
  bonuses: number;
  discounts: number;
  net_estimated: number;
}

interface Pharmacy {
  id: string;
  trade_name: string;
  city?: string | null;
  legal_name?: string | null;
  cnpj?: string | null;
  phone?: string | null;
  email?: string | null;
  state?: string | null;
  status?: string | null;
  notes?: string | null;
}

function InfoItem({ label, value }: { label: string; value: string | null | undefined }) {
  const shown = value != null && String(value).trim() !== '' ? String(value) : '—';
  return (
    <div className="space-y-1">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <p className="text-sm font-medium">{shown}</p>
    </div>
  );
}

interface Driver {
  id: string;
  name: string;
  primary_pharmacy_id: string;
  primary_pharmacy?: { trade_name: string };
  /** Farmácias da rede do líder com vínculo ativo (driver_pharmacy_links). */
  leader_linked_pharmacy_ids?: string[];
}

interface LeaderSupplyRequest {
  id: string;
  item_type: 'uniform' | 'bag';
  status: string;
  quantity: number;
  size?: string | null;
  created_at: string;
  tracking_link?: string | null;
  drivers?: { name: string } | null;
  pharmacies?: { trade_name: string } | null;
}

interface AbsenceFormData {
  pharmacy_id: string;
  driver_id: string;
  date: string;
  reason: string;
}

interface DailyFormData {
  pharmacy_id: string;
  driver_id: string;
  amount: string;
  description: string;
}

interface DailyFormSubmit extends Omit<DailyFormData, 'amount'> {
  amount: number;
}

interface SupplyFormPayload {
  pharmacy_id: string;
  driver_id: string;
  item_type: 'uniform' | 'bag';
  size: string;
  quantity: number;
}

type LucideIcon = ComponentType<LucideProps>;

export default function LeaderPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'overview' | 'entregadores' | 'absences' | 'dailies' | 'pharmacies' | 'supplies'>(
    'overview'
  );
  const [selectedPharmacyId, setSelectedPharmacyId] = useState<string | null>(null);
  const [driverSheetId, setDriverSheetId] = useState<string | null>(null);
  const [driverSearch, setDriverSearch] = useState('');
  const [pharmacySearch, setPharmacySearch] = useState('');

  // Queries
  const { data: stats, isLoading: statsLoading } = useQuery<LeaderStats>({
    queryKey: ['leader-stats'],
    queryFn: () => api.get('/api/leader-portal/stats').then(r => r.data),
  });

  const { data: supplies = [] } = useQuery<LeaderSupplyRequest[]>({
    queryKey: ['leader-supplies'],
    queryFn: () => api.get('/api/leader-portal/supply-requests').then(r => r.data),
    enabled: tab === 'supplies' || tab === 'overview',
  });

  const { data: pharmacies = [], isLoading: pharmaciesLoading } = useQuery<Pharmacy[]>({
    queryKey: ['leader-pharmacies'],
    queryFn: () => api.get('/api/leader-portal/pharmacies').then(r => r.data),
    enabled: tab === 'pharmacies' || tab === 'absences' || tab === 'dailies' || tab === 'supplies',
  });

  const { data: drivers = [], isLoading: driversLoading } = useQuery<Driver[]>({
    queryKey: ['leader-drivers'],
    queryFn: () => api.get('/api/leader-portal/drivers').then(r => r.data),
    enabled: tab === 'absences' || tab === 'dailies' || tab === 'supplies' || tab === 'entregadores',
  });

  // Mutações
  const absenceMutation = useMutation({
    mutationFn: (data: AbsenceFormData) => api.post('/api/leader-portal/absences', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leader-stats'] });
      alert('Falta lançada com sucesso!');
    }
  });

  const dailyMutation = useMutation({
    mutationFn: (data: DailyFormSubmit) => api.post('/api/leader-portal/dailies', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leader-stats'] });
      alert('Diária lançada com sucesso!');
    }
  });

  const supplyMutation = useMutation({
    mutationFn: (data: SupplyFormPayload) => api.post('/api/leader-portal/supply-requests', data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['leader-supplies'] });
      alert('Solicitação enviada com sucesso!');
    }
  });

  const firstName = user?.name?.split(' ')[0] || 'líder';

  const filteredLeaderDrivers = useMemo(() => {
    const q = driverSearch.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter(
      (d) =>
        d.name.toLowerCase().includes(q) ||
        (d.primary_pharmacy?.trade_name || '').toLowerCase().includes(q)
    );
  }, [drivers, driverSearch]);

  const filteredLeaderPharmacies = useMemo(() => {
    const q = pharmacySearch.trim().toLowerCase();
    if (!q) return pharmacies;
    return pharmacies.filter(
      (p) =>
        (p.trade_name || '').toLowerCase().includes(q) ||
        (p.city || '').toLowerCase().includes(q)
    );
  }, [pharmacies, pharmacySearch]);

  useEffect(() => {
    if (tab !== 'pharmacies' || !selectedPharmacyId) return;
    if (!filteredLeaderPharmacies.some((p) => p.id === selectedPharmacyId)) setSelectedPharmacyId(null);
  }, [tab, selectedPharmacyId, filteredLeaderPharmacies]);

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="shrink-0 border-b border-border bg-muted/40 px-6 py-6 backdrop-blur sm:px-8">
        <PageHeader
          icon={ShieldCheck}
          eyebrow="Painel do líder"
          title={`Olá, ${firstName}`}
          description="Acompanhe sua rede, lance faltas e diárias e cuide da operação do dia."
          compact
          actions={
            <div className="flex items-center gap-3">
              <div className="hidden flex-col items-end sm:flex">
                <span className="text-xs text-muted-foreground">Ciclo atual</span>
                <span className="text-sm font-semibold text-primary">26/04 a 04/05</span>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/15 text-primary">
                <Calendar size={20} />
              </div>
            </div>
          }
        />
      </div>

      <div className="grid shrink-0 grid-cols-1 gap-3 border-b border-border px-6 py-4 sm:px-8 md:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          icon={Building2} 
          label="Farmácias" 
          value={statsLoading ? '...' : (stats?.pharmacies_count || 0)} 
          color="var(--accent)"
          onClick={() => setTab('pharmacies')}
        />
        <StatCard 
          icon={Users} 
          label="Entregadores" 
          value={statsLoading ? '...' : (stats?.drivers_count || 0)} 
          color="var(--success)"
          onClick={() => setTab('entregadores')}
        />
        <StatCard 
          icon={AlertCircle} 
          label="Faltas Pendentes" 
          value={statsLoading ? '...' : (stats?.pending_absences || 0)} 
          color="var(--danger)"
          onClick={() => setTab('absences')}
        />
        <StatCard 
          icon={Clock} 
          label="Diárias Pendentes" 
          value={statsLoading ? '...' : (stats?.pending_dailies || 0)} 
          color="var(--warning)"
          onClick={() => setTab('dailies')}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 overflow-x-auto border-b border-border px-6 pb-px sm:px-8">
          <TabButton active={tab === 'overview'} onClick={() => setTab('overview')} label="Visão Geral" />
          <TabButton active={tab === 'entregadores'} onClick={() => setTab('entregadores')} label="Entregadores" />
          <TabButton active={tab === 'absences'} onClick={() => setTab('absences')} label="Faltas" />
          <TabButton active={tab === 'dailies'} onClick={() => setTab('dailies')} label="Diárias" />
          <TabButton active={tab === 'supplies'} onClick={() => setTab('supplies')} label="Uniformes / Bags" />
          <TabButton active={tab === 'pharmacies'} onClick={() => setTab('pharmacies')} label="Minhas Farmácias" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl px-6 py-6 pb-10 sm:px-8">
          {tab === 'entregadores' && (
            <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="border-b border-border p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <FormControl
                      value={driverSearch}
                      onChange={(e) => setDriverSearch(e.target.value)}
                      placeholder="Buscar entregador…"
                      inputSize="sm"
                      className="pl-8 pr-3 text-xs"
                    />
                  </div>
                </div>
                <ul className="divide-y divide-border">
                  {driversLoading ? (
                    <li className="p-4 text-sm text-muted-foreground">Carregando…</li>
                  ) : filteredLeaderDrivers.length === 0 ? (
                    <li className="p-4 text-sm text-muted-foreground">
                      {drivers.length === 0
                        ? 'Nenhum entregador ativo vinculado às suas farmácias.'
                        : 'Nenhum resultado para a busca.'}
                    </li>
                  ) : (
                    filteredLeaderDrivers.map((d) => {
                      const active = driverSheetId === d.id;
                      return (
                        <li key={d.id}>
                          <button
                            type="button"
                            onClick={() => setDriverSheetId(d.id)}
                            className={cn('flex w-full items-center gap-3 p-3 text-left', interactiveRowSurface(active))}
                          >
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/30 to-channel-instagram/30 text-xs font-semibold text-primary-foreground">
                              {d.name
                                .split(' ')
                                .map((n) => n[0])
                                .slice(0, 2)
                                .join('')}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className={cn('truncate text-xs font-medium', interactiveRowPrimary(active))}>{d.name}</div>
                              <div className={cn('truncate text-[10px]', interactiveRowSecondary(active))}>
                                {d.primary_pharmacy?.trade_name || '—'}
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
              <div className="hidden min-h-[280px] flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/40 p-8 text-center text-sm text-muted-foreground lg:flex">
                Toque em um entregador à esquerda para abrir a <span className="mx-1 font-medium text-foreground">ficha completa</span> (escala,
                vínculos e contato).
              </div>
            </div>
          )}

          {tab === 'overview' && (
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2 space-y-6">
                <div className="panel p-6">
                  <h3 className="text-lg font-semibold mb-4">Próximos Prazos</h3>
                  <div className="space-y-4">
                    <DeadlineItem 
                      title="Lançamento de Faltas" 
                      deadline="Segunda, 11:00" 
                      status="warning"
                      description="Referente ao ciclo de 26/04 a 04/05."
                    />
                    <DeadlineItem 
                      title="Lançamento de Diárias" 
                      deadline="Terça e Quinta, 11:00" 
                      status="ok"
                      description="Próximo pagamento na quinta-feira."
                    />
                  </div>
                </div>

                <div className="panel p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">Últimas Solicitações</h3>
                    <button onClick={() => setTab('supplies')} className="text-xs text-accent hover:underline">Ver todas</button>
                  </div>
                  {supplies.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-muted-foreground border-2 border-dashed border-border rounded-xl">
                      <Package size={48} className="mb-2 opacity-20" />
                      <p className="text-sm">Nenhuma solicitação ativa</p>
                      <Button onClick={() => setTab('supplies')} variant="secondary" className="mt-4">Nova Solicitação</Button>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {supplies.slice(0, 3).map((s) => (
                        <div key={s.id} className="flex items-center justify-between p-3 rounded-lg bg-muted">
                          <div className="flex items-center gap-3">
                            <Package size={16} className="text-muted-foreground" />
                            <div>
                              <p className="text-sm font-medium">{s.item_type === 'uniform' ? 'Uniforme' : 'Bag'} - {s.drivers?.name}</p>
                              <p className="text-[10px] text-muted-foreground uppercase">{s.status}</p>
                            </div>
                          </div>
                          {s.tracking_link && (
                            <a href={s.tracking_link} target="_blank" rel="noreferrer" className="text-[10px] text-accent">Rastrear</a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              <div className="space-y-6">
                <div className="panel p-6 bg-accent/5 border-accent/20">
                  <h3 className="text-lg font-semibold text-accent mb-2">Resumo Financeiro</h3>
                  <p className="text-xs text-muted-foreground mb-4">Estimativa para o próximo fechamento</p>
                  {statsLoading ? (
                    <div className="space-y-3 animate-pulse">
                      <div className="h-4 bg-accent/10 rounded w-full" />
                      <div className="h-4 bg-accent/10 rounded w-full" />
                      <div className="h-4 bg-accent/10 rounded w-full" />
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Faturamento Base</span>
                        <span className="font-mono">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats?.base_revenue || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Bonificações (Diárias)</span>
                        <span className="font-mono text-success">+ {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats?.bonuses || 0)}</span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Descontos (Faltas/Kits)</span>
                        <span className="font-mono text-danger">- {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats?.discounts || 0)}</span>
                      </div>
                      <div className="h-px bg-accent/20 my-2" />
                      <div className="flex justify-between text-base font-bold">
                        <span>Líquido Estimado</span>
                        <span className="font-mono text-accent">{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats?.net_estimated || 0)}</span>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {tab === 'absences' && (
            <AbsenceForm 
              pharmacies={pharmacies} 
              drivers={drivers} 
              onSave={(data: unknown) => absenceMutation.mutate(data)}
              isLoading={absenceMutation.isPending || pharmaciesLoading || driversLoading}
            />
          )}

          {tab === 'dailies' && (
            <DailyForm 
              pharmacies={pharmacies} 
              drivers={drivers} 
              onSave={(data: unknown) => dailyMutation.mutate(data)}
              isLoading={dailyMutation.isPending || pharmaciesLoading || driversLoading}
            />
          )}

          {tab === 'supplies' && (
            <SupplyForm 
              pharmacies={pharmacies} 
              drivers={drivers} 
              onSave={(data: unknown) => supplyMutation.mutate(data)}
              isLoading={supplyMutation.isPending || pharmaciesLoading || driversLoading}
              history={supplies}
            />
          )}

          {tab === 'pharmacies' && (
            <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
              <div className="flex max-h-[min(70vh,640px)] min-h-0 flex-col overflow-hidden rounded-xl border border-border bg-card">
                <div className="shrink-0 border-b border-border p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <FormControl
                      value={pharmacySearch}
                      onChange={(e) => setPharmacySearch(e.target.value)}
                      placeholder="Buscar farmácia…"
                      inputSize="sm"
                      className="pl-8 pr-3 text-xs"
                    />
                  </div>
                </div>
                <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
                  {pharmaciesLoading ? (
                    <li className="p-4 text-sm text-muted-foreground">Carregando farmácias…</li>
                  ) : filteredLeaderPharmacies.length === 0 ? (
                    <li className="p-4 text-sm text-muted-foreground">
                      {pharmacies.length === 0 ? 'Nenhuma farmácia vinculada.' : 'Nenhum resultado para a busca.'}
                    </li>
                  ) : (
                    filteredLeaderPharmacies.map((p) => {
                      const active = selectedPharmacyId === p.id;
                      return (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedPharmacyId(p.id)}
                            className={cn('flex w-full items-center gap-3 p-3 text-left', interactiveRowSurface(active))}
                          >
                            <IconTile icon={Building2} tone="primary" size="md" />
                            <div className="min-w-0 flex-1">
                              <div className={cn('truncate text-xs font-medium', interactiveRowPrimary(active))}>{p.trade_name}</div>
                              <div className={cn('truncate text-[10px]', interactiveRowSecondary(active))}>{p.city || '—'}</div>
                            </div>
                            <ChevronRight className={cn('h-3.5 w-3.5 shrink-0', interactiveRowSecondary(active))} />
                          </button>
                        </li>
                      );
                    })
                  )}
                </ul>
              </div>

              <div className="min-h-[280px] rounded-xl border border-border bg-card p-6 lg:min-h-[360px]">
                {!selectedPharmacyId ? (
                  <div className="flex h-full min-h-[240px] flex-col items-center justify-center text-center text-sm text-muted-foreground">
                    Selecione uma farmácia à esquerda para ver a ficha completa.
                  </div>
                ) : (
                  <div className="space-y-6">
                    {pharmacies
                      .filter((p) => p.id === selectedPharmacyId)
                      .map((p) => (
                        <div key={p.id} className="space-y-6">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="flex items-center gap-4">
                              <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-primary/25 to-channel-instagram/25 text-primary">
                                <Building2 size={28} />
                              </div>
                              <div className="min-w-0">
                                <h3 className="text-lg font-semibold text-foreground">{p.trade_name}</h3>
                                <p className="text-xs text-muted-foreground">{p.legal_name}</p>
                                <span
                                  className={cn(
                                    'mt-2 inline-flex rounded-full border px-2 py-0.5 text-[10px] font-medium',
                                    p.status === 'active'
                                      ? 'border-success/40 bg-success/10 text-success'
                                      : 'border-border bg-muted/30 text-muted-foreground'
                                  )}
                                >
                                  {p.status === 'active' ? 'Operando' : 'Inativa'}
                                </span>
                              </div>
                            </div>
                          </div>

                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                            <div className="rounded-lg border border-border bg-muted/30 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">CNPJ</div>
                              <div className="mt-1 text-sm font-medium text-foreground">{p.cnpj || '—'}</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/30 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Telefone</div>
                              <div className="mt-1 text-sm font-medium text-foreground">{p.phone || '—'}</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/30 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">E-mail</div>
                              <div className="mt-1 text-sm font-medium text-foreground">{p.email || '—'}</div>
                            </div>
                            <div className="rounded-lg border border-border bg-muted/30 p-3">
                              <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cidade / UF</div>
                              <div className="mt-1 text-sm font-medium text-foreground">
                                {p.city ?? '—'} {p.state ? ` / ${p.state}` : ''}
                              </div>
                            </div>
                          </div>

                          {p.notes ? (
                            <div className="border-t border-border pt-4">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Observações</p>
                              <p className="text-sm text-foreground">{p.notes}</p>
                            </div>
                          ) : null}
                        </div>
                      ))}
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
        </div>
      </div>

      <DriverLeaderDetailModal
        driverId={driverSheetId}
        open={Boolean(driverSheetId)}
        onClose={() => setDriverSheetId(null)}
      />
    </div>
  );
}

function DriverLeaderDetailModal({
  driverId,
  open,
  onClose,
}: {
  driverId: string | null;
  open: boolean;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [scheduleDraft, setScheduleDraft] = useState<Record<string, unknown>>({});

  const detailQuery = useQuery({
    queryKey: ['leader-portal-driver', driverId],
    enabled: open && Boolean(driverId),
    queryFn: () => api.get(`/api/leader-portal/drivers/${driverId}`).then((r) => r.data),
  });

  useEffect(() => {
    const ws = detailQuery.data?.work_schedule;
    if (ws && typeof ws === 'object') setScheduleDraft(ws as Record<string, unknown>);
    else if (detailQuery.data?.id) setScheduleDraft({});
  }, [detailQuery.data?.id, detailQuery.data?.work_schedule]);

  const saveSchedule = useMutation({
    mutationFn: async () => {
      await api.patch(`/api/leader-portal/drivers/${driverId}/schedule`, {
        work_schedule: serializeWorkScheduleForApi(scheduleDraft),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leader-drivers'] });
      qc.invalidateQueries({ queryKey: ['leader-portal-driver', driverId] });
      qc.invalidateQueries({ queryKey: ['leader-stats'] });
    },
  });

  if (!open) return null;

  const d = detailQuery.data as Record<string, unknown> | undefined;
  const links = (d?.driver_pharmacy_links as Array<{ is_active?: boolean; is_primary?: boolean; pharmacies?: { trade_name?: string } | { trade_name?: string }[] }>) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/60 backdrop-blur-sm p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-border bg-muted shadow-md">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="text-sm font-semibold">Ficha do entregador</div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-xs text-muted-foreground hover:bg-sidebar-accent/60">
            Fechar
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-6">
          {detailQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : detailQuery.isError ? (
            <p className="text-sm text-destructive">Não foi possível carregar o entregador.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <InfoItem label="Nome" value={String(d?.name ?? '')} />
                <InfoItem label="Telefone" value={d?.phone ? formatBrazilPhone(String(d.phone)) : ''} />
                <InfoItem label="CPF" value={String(d?.cpf ?? '')} />
                <InfoItem label="E-mail" value={String(d?.email ?? '')} />
                <InfoItem label="Cidade" value={String(d?.city ?? '')} />
                <InfoItem label="UF" value={String(d?.state ?? '')} />
                <InfoItem label="Status" value={String(d?.status ?? '')} />
                <InfoItem label="É líder (cadastro)" value={d?.is_leader ? 'Sim' : 'Não'} />
              </div>

              <div className="rounded-xl border border-border bg-muted/40 p-4">
                <p className="text-[10px] font-bold uppercase text-muted-foreground mb-2">Vínculos com farmácias</p>
                <ul className="space-y-1 text-sm">
                  {links.filter((l) => l.is_active !== false).map((l, i) => {
                    const ph = Array.isArray(l.pharmacies) ? l.pharmacies[0] : l.pharmacies;
                    const tn = ph?.trade_name || '—';
                    return (
                      <li key={i}>
                        {tn}
                        {l.is_primary ? <span className="ml-2 text-[10px] text-accent">(primário)</span> : null}
                      </li>
                    );
                  })}
                  {links.filter((l) => l.is_active !== false).length === 0 ? (
                    <li className="text-muted-foreground text-xs">—</li>
                  ) : null}
                </ul>
              </div>

              <div className="rounded-xl border border-accent/30 bg-accent/5 p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                  <p className="text-sm font-semibold text-accent">Escala de trabalho</p>
                  <button
                    type="button"
                    disabled={saveSchedule.isPending}
                    onClick={() => driverId && saveSchedule.mutate()}
                    className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-accent-foreground disabled:opacity-50"
                  >
                    {saveSchedule.isPending ? 'Salvando…' : 'Salvar escala'}
                  </button>
                </div>
                <BusinessHoursEditor key={driverId || 'x'} value={scheduleDraft} onChange={setScheduleDraft} />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  onClick,
}: {
  icon: LucideIcon;
  label: string;
  value: string | number;
  color: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/30 hover:bg-sidebar-accent/60',
        onClick ? 'cursor-pointer' : 'cursor-default'
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 shrink-0" style={{ color }} />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight text-foreground">{value}</div>
    </button>
  );
}

function TabButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'relative shrink-0 rounded-md px-3 py-2.5 text-sm font-medium transition-colors sm:px-4 sm:py-3',
        active ? 'text-primary' : 'text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
      )}
    >
      {label}
      {active ? <div className="absolute bottom-0 left-2 right-2 h-0.5 rounded-full bg-primary sm:left-3 sm:right-3" /> : null}
    </button>
  );
}

function DeadlineItem({
  title,
  deadline,
  status,
  description,
}: {
  title: string;
  deadline: string;
  status: 'warning' | 'ok';
  description: string;
}) {
  return (
    <div className="flex items-start gap-3 p-3 rounded-xl bg-muted">
      <div className={cn(
        "mt-0.5 h-2 w-2 rounded-full shrink-0",
        status === 'warning' ? "bg-warning animate-pulse" : "bg-success"
      )} />
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-semibold">{title}</p>
          <span className="text-[10px] font-bold uppercase tracking-tight text-muted-foreground flex items-center gap-1">
            <Clock size={10} />
            {deadline}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
      </div>
    </div>
  );
}

function AbsenceForm({
  pharmacies,
  drivers,
  onSave,
  isLoading,
}: {
  pharmacies: Pharmacy[];
  drivers: Driver[];
  onSave: (data: AbsenceFormData) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({
    pharmacy_id: '',
    driver_id: '',
    date: new Date().toISOString().split('T')[0],
    reason: ''
  });

  const filteredDrivers = useMemo(() => {
    if (!form.pharmacy_id) return [];
    return drivers.filter((d: Driver & { leader_linked_pharmacy_ids?: string[] }) =>
      (d.leader_linked_pharmacy_ids || []).includes(form.pharmacy_id)
    );
  }, [form.pharmacy_id, drivers]);

  return (
    <div className="max-w-2xl mx-auto panel p-8">
      <h3 className="text-xl font-bold mb-6">Novo Registro de Falta</h3>
      <div className="grid gap-6">
        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Farmácia</span>
            <FormSearchCombobox
              value={form.pharmacy_id}
              onChange={(v) => setForm({ ...form, pharmacy_id: v, driver_id: '' })}
              placeholder="Buscar farmácia…"
              options={pharmacies.map((p) => ({ value: p.id, label: p.trade_name }))}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Data da Falta</span>
            <input 
              type="date" 
              lang="pt-BR"
              className={brFieldClassName}
              value={form.date}
              onChange={e => setForm({ ...form, date: e.target.value })}
            />
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Entregador</span>
          <FormSearchCombobox
            value={form.driver_id}
            onChange={(v) => setForm({ ...form, driver_id: v })}
            disabled={!form.pharmacy_id}
            placeholder={form.pharmacy_id ? 'Buscar entregador…' : 'Selecione a farmácia primeiro'}
            options={filteredDrivers.map((d) => ({ value: d.id, label: d.name }))}
          />
        </label>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Motivo / Observação</span>
          <Textarea 
            className={brFieldClassName}
            placeholder="Ex: Não compareceu, atestado, etc."
            rows={4}
            value={form.reason}
            onChange={e => setForm({ ...form, reason: e.target.value })}
          />
        </label>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" className="px-8">Cancelar</Button>
          <Button 
            className="px-8"
            disabled={!form.driver_id || isLoading}
            onClick={() => onSave(form)}
          >
            {isLoading ? "Salvando..." : "Registrar Falta"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function DailyForm({
  pharmacies,
  drivers,
  onSave,
  isLoading,
}: {
  pharmacies: Pharmacy[];
  drivers: Driver[];
  onSave: (data: DailyFormSubmit) => void;
  isLoading: boolean;
}) {
  const [form, setForm] = useState({
    pharmacy_id: '',
    driver_id: '',
    amount: '',
    description: ''
  });

  const filteredDrivers = useMemo(() => {
    if (!form.pharmacy_id) return [];
    return drivers.filter((d: Driver & { leader_linked_pharmacy_ids?: string[] }) =>
      (d.leader_linked_pharmacy_ids || []).includes(form.pharmacy_id)
    );
  }, [form.pharmacy_id, drivers]);

  return (
    <div className="max-w-2xl mx-auto panel p-8">
      <h3 className="text-xl font-bold mb-6">Lançamento de Diária Extra</h3>
      <div className="grid gap-6">
        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Farmácia</span>
          <FormSearchCombobox
            value={form.pharmacy_id}
            onChange={(v) => setForm({ ...form, pharmacy_id: v, driver_id: '' })}
            placeholder="Buscar farmácia…"
            options={pharmacies.map((p) => ({ value: p.id, label: p.trade_name }))}
          />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Entregador</span>
            <FormSearchCombobox
              value={form.driver_id}
              onChange={(v) => setForm({ ...form, driver_id: v })}
              disabled={!form.pharmacy_id}
              placeholder={form.pharmacy_id ? 'Buscar entregador…' : 'Selecione a farmácia primeiro'}
              options={filteredDrivers.map((d) => ({ value: d.id, label: d.name }))}
            />
          </label>
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Valor (R$)</span>
            <input 
              type="number" 
              className={cn(brFieldClassName, 'mono')} 
              placeholder="0.00"
              value={form.amount}
              onChange={e => setForm({ ...form, amount: e.target.value })}
            />
          </label>
        </div>

        <label className="flex flex-col gap-2">
          <span className="text-sm font-medium">Descrição / Motivo</span>
          <input 
            type="text" 
            className={brFieldClassName}
            placeholder="Ex: Apoio extra feriado, chuva, etc."
            value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
          />
        </label>

        <div className="flex justify-end gap-3 pt-4">
          <Button variant="secondary" className="px-8">Cancelar</Button>
          <Button 
            className="px-8"
            disabled={!form.driver_id || !form.amount || isLoading}
            onClick={() => onSave({ ...form, amount: Number(form.amount) })}
          >
            {isLoading ? "Salvando..." : "Lançar Diária"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function SupplyForm({
  pharmacies,
  drivers,
  onSave,
  isLoading,
  history,
}: {
  pharmacies: Pharmacy[];
  drivers: Driver[];
  onSave: (data: SupplyFormPayload) => void;
  isLoading: boolean;
  history: LeaderSupplyRequest[];
}) {
  const [form, setForm] = useState<SupplyFormPayload>({
    pharmacy_id: '',
    driver_id: '',
    item_type: 'uniform',
    size: 'M',
    quantity: 1,
  });

  const filteredDrivers = useMemo(() => {
    if (!form.pharmacy_id) return [];
    return drivers.filter((d: Driver & { leader_linked_pharmacy_ids?: string[] }) =>
      (d.leader_linked_pharmacy_ids || []).includes(form.pharmacy_id)
    );
  }, [form.pharmacy_id, drivers]);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="panel p-8">
        <h3 className="text-xl font-bold mb-6">Solicitar Uniforme ou Bag</h3>
        <div className="grid gap-6">
          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Farmácia</span>
            <FormSearchCombobox
              value={form.pharmacy_id}
              onChange={(v) => setForm({ ...form, pharmacy_id: v, driver_id: '' })}
              placeholder="Buscar farmácia…"
              options={pharmacies.map((p) => ({ value: p.id, label: p.trade_name }))}
            />
          </label>

          <label className="flex flex-col gap-2">
            <span className="text-sm font-medium">Entregador</span>
            <FormSearchCombobox
              value={form.driver_id}
              onChange={(v) => setForm({ ...form, driver_id: v })}
              disabled={!form.pharmacy_id}
              placeholder={form.pharmacy_id ? 'Buscar entregador…' : 'Selecione a farmácia primeiro'}
              options={filteredDrivers.map((d) => ({ value: d.id, label: d.name }))}
            />
          </label>

          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Item</span>
              <FormSelect
                value={form.item_type}
                onChange={(v) => setForm({ ...form, item_type: v as SupplyFormPayload['item_type'] })}
                options={[
                  { value: 'uniform', label: 'Uniforme (Camiseta)' },
                  { value: 'bag', label: 'Bag (Mochila)' },
                ]}
              />
            </label>
            {form.item_type === 'uniform' && (
              <label className="flex flex-col gap-2">
                <span className="text-sm font-medium">Tamanho</span>
                <FormSelect
                  value={form.size}
                  onChange={(v) => setForm({ ...form, size: v })}
                  options={[
                    { value: 'P', label: 'P' },
                    { value: 'M', label: 'M' },
                    { value: 'G', label: 'G' },
                    { value: 'GG', label: 'GG' },
                    { value: 'XG', label: 'XG' },
                  ]}
                />
              </label>
            )}
            <label className="flex flex-col gap-2">
              <span className="text-sm font-medium">Quantidade</span>
              <input 
                type="number" 
                className={brFieldClassName} 
                min={1} 
                max={10}
                value={form.quantity}
                onChange={e => setForm({ ...form, quantity: parseInt(e.target.value) || 1 })}
              />
            </label>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button className="px-8 w-full" disabled={!form.driver_id || isLoading} onClick={() => onSave(form)}>
              {isLoading ? "Enviando..." : "Enviar Solicitação"}
            </Button>
          </div>
        </div>
      </div>

      <div className="panel p-8">
        <h3 className="text-lg font-semibold mb-4">Histórico de Solicitações</h3>
        <div className="space-y-4">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground italic">Nenhuma solicitação encontrada.</p>
          ) : (
            history.map((s) => (
              <div key={s.id} className="p-4 rounded-xl border border-border bg-muted">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className={cn(
                      "text-[10px] font-bold uppercase px-2 py-0.5 rounded",
                      s.status === 'pending' ? "bg-warning/15 text-warning" : "bg-success/15 text-success"
                    )}>
                      {s.status}
                    </span>
                    <h4 className="text-sm font-bold mt-1">
                      {s.quantity > 1 ? `${s.quantity}x ` : ''}
                      {s.item_type === 'uniform' ? 'Uniforme' : 'Bag'} {s.size ? `(${s.size})` : ''}
                    </h4>
                  </div>
                  <span className="text-xs text-muted-foreground">{formatDateBr(s.created_at)}</span>
                </div>
                <p className="text-xs text-muted-foreground">Entregador: {s.drivers?.name}</p>
                <p className="text-xs text-muted-foreground">Farmácia: {s.pharmacies?.trade_name}</p>
                {s.tracking_link && (
                  <div className="mt-3 pt-3 border-t border-border/50">
                    <p className="text-[10px] text-muted-foreground mb-1">Rastreio:</p>
                    <a href={s.tracking_link} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline flex items-center gap-1">
                      Link de acompanhamento <ChevronRight size={12} />
                    </a>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}


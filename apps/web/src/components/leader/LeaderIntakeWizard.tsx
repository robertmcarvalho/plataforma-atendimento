'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import {
  Bike,
  Building2,
  Check,
  ChevronRight,
  Layers,
  ListTodo,
  Loader2,
  Search,
  SkipForward,
  X,
} from 'lucide-react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

const STEPS_ORDER = ['pharmacy', 'driver', 'sector', 'demand'] as const;

type Pharmacy = { id: string; trade_name: string; city?: string | null; address_line?: string | null };
type Driver = {
  id: string;
  name: string;
  phone?: string | null;
  leader_linked_pharmacy_ids?: string[];
};
type Sector = { id: string; name: string; is_active?: boolean | null };
type Demand = { demand_key: string; title: string };

export type LeaderIntakeStartPayload = {
  pharmacy_id: string;
  driver_id: string | null;
  sector_id: string;
  demand_key: string;
};

type Props = {
  open: boolean;
  verified: boolean;
  onClose: () => void;
  onStarted: (conversationId: string) => void;
};

type Step = (typeof STEPS_ORDER)[number];

const STEP_LABELS: Record<Step, string> = {
  pharmacy: 'Farmácia',
  driver: 'Entregador (opcional)',
  sector: 'Setor',
  demand: 'Demanda',
};

const STEP_ICONS = {
  pharmacy: Building2,
  driver: Bike,
  sector: Layers,
  demand: ListTodo,
} as const;

const searchInputClassName =
  'w-full rounded-md border border-border bg-background/40 pl-8 pr-3 py-2 text-xs text-foreground outline-none focus:border-primary/50';

const rowButtonClassName =
  'flex w-full items-center gap-3 rounded-lg border border-border bg-background/30 p-3 text-left transition-colors hover:border-primary/40 hover:bg-sidebar-accent/60';

function errMessage(e: unknown) {
  const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
  return msg || (e instanceof Error ? e.message : 'Falha na operação.');
}

function pharmacySubtitle(p: Pharmacy): string | null {
  return p.address_line || p.city || null;
}

function ContextBanner({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-background/30 px-3 py-2 text-[11px] text-muted-foreground">
      {children}
    </div>
  );
}

function IntakeStepper({ step, stepIndex }: { step: Step; stepIndex: number }) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-border bg-background/30 px-5 py-3">
      {STEPS_ORDER.map((s, i) => {
        const Icon = STEP_ICONS[s];
        const isActive = s === step;
        const isDone = i < stepIndex;
        return (
          <div key={s} className="flex items-center gap-2">
            <div
              className={cn(
                'flex items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] transition-colors',
                isActive && 'border-primary/60 bg-primary/10 text-primary',
                isDone && !isActive && 'border-success/40 bg-success/10 text-success',
                !isActive && !isDone && 'border-border text-muted-foreground'
              )}
            >
              {isDone ? <Check className="h-3 w-3 shrink-0" /> : <Icon className="h-3 w-3 shrink-0" />}
              <span className="whitespace-nowrap">{STEP_LABELS[s]}</span>
            </div>
            {i < STEPS_ORDER.length - 1 ? <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" /> : null}
          </div>
        );
      })}
    </div>
  );
}

export function LeaderIntakeWizard({ open, verified, onClose, onStarted }: Props) {
  const [step, setStep] = useState<Step>('pharmacy');
  const [pharmacyId, setPharmacyId] = useState<string | null>(null);
  const [driverId, setDriverId] = useState<string | null>(null);
  const [sectorId, setSectorId] = useState<string | null>(null);
  const [demandKey, setDemandKey] = useState<string | null>(null);
  const [pharmacySearch, setPharmacySearch] = useState('');
  const [driverSearch, setDriverSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setStep('pharmacy');
    setPharmacyId(null);
    setDriverId(null);
    setSectorId(null);
    setDemandKey(null);
    setPharmacySearch('');
    setDriverSearch('');
    setError(null);
  }, [open]);

  const pharmaciesQuery = useQuery<Pharmacy[]>({
    queryKey: ['leader-portal', 'pharmacies'],
    queryFn: async () => (await api.get('/api/leader-portal/pharmacies')).data as Pharmacy[],
    enabled: open && verified,
  });

  const driversQuery = useQuery<Driver[]>({
    queryKey: ['leader-portal', 'drivers'],
    queryFn: async () => (await api.get('/api/leader-portal/drivers')).data as Driver[],
    enabled: open && verified,
  });

  const sectorsQuery = useQuery<Sector[]>({
    queryKey: ['sectors'],
    queryFn: async () => (await api.get('/api/sectors')).data as Sector[],
    enabled: open && verified,
  });

  const pharmacies = pharmaciesQuery.data || [];
  const sectors = useMemo(() => (sectorsQuery.data || []).filter((s) => s.is_active !== false), [sectorsQuery.data]);

  useEffect(() => {
    if (!open || pharmacies.length !== 1 || pharmacyId) return;
    setPharmacyId(pharmacies[0].id);
    setStep('driver');
  }, [open, pharmacies, pharmacyId]);

  const driversAtPharmacy = useMemo(() => {
    if (!pharmacyId) return [];
    return (driversQuery.data || []).filter((d) => (d.leader_linked_pharmacy_ids || []).includes(pharmacyId));
  }, [driversQuery.data, pharmacyId]);

  const filteredPharmacies = useMemo(() => {
    const q = pharmacySearch.trim().toLowerCase();
    if (!q) return pharmacies;
    return pharmacies.filter((p) =>
      `${p.trade_name} ${p.address_line || ''} ${p.city || ''}`.toLowerCase().includes(q)
    );
  }, [pharmacies, pharmacySearch]);

  const filteredDriversAtPharmacy = useMemo(() => {
    const q = driverSearch.trim().toLowerCase();
    if (!q) return driversAtPharmacy;
    return driversAtPharmacy.filter((d) =>
      `${d.name} ${d.phone || ''}`.toLowerCase().includes(q)
    );
  }, [driversAtPharmacy, driverSearch]);

  const demandsQuery = useQuery({
    queryKey: ['leader-portal', 'intake-demands', sectorId, driverId],
    queryFn: async () => {
      const params: Record<string, string> = { sector_id: sectorId! };
      if (driverId) params.driver_id = driverId;
      const { data } = await api.get('/api/leader-portal/intake/demands', { params });
      return data as { demands: Demand[]; demand_profile: string; source: string };
    },
    enabled: open && verified && step === 'demand' && Boolean(sectorId),
  });

  const startMut = useMutation({
    mutationFn: async (payload: LeaderIntakeStartPayload) => {
      const { data } = await api.post<{ id: string }>('/api/leader-portal/conversations/start', payload);
      return data;
    },
    onSuccess: (data) => {
      setError(null);
      onStarted(data.id);
      onClose();
    },
    onError: (e) => setError(errMessage(e)),
  });

  if (!open) return null;

  const busy = startMut.isPending;
  const stepIndex = STEPS_ORDER.indexOf(step);
  const selectedPharmacy = pharmacies.find((p) => p.id === pharmacyId);
  const selectedDriver = driversAtPharmacy.find((d) => d.id === driverId);
  const selectedSector = sectors.find((s) => s.id === sectorId);

  function goBack() {
    setError(null);
    if (stepIndex > 0) {
      setStep(STEPS_ORDER[stepIndex - 1]);
      return;
    }
    onClose();
  }

  function finishStart(key?: string) {
    const dk = key ?? demandKey;
    if (!pharmacyId || !sectorId || !dk) return;
    startMut.mutate({
      pharmacy_id: pharmacyId,
      driver_id: driverId,
      sector_id: sectorId,
      demand_key: dk,
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
      <div className="relative flex max-h-[88vh] w-[min(720px,92vw)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-glow">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Novo atendimento</div>
            <h2 className="text-base font-semibold">Iniciar nova conversa</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:bg-sidebar-accent/60"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <IntakeStepper step={step} stepIndex={stepIndex} />

        <div className="flex-1 overflow-auto p-5">
          <div className="space-y-3">
            {!verified ? (
              <p className="text-sm text-destructive">Verifique seu WhatsApp antes de abrir um atendimento.</p>
            ) : null}

            {step === 'pharmacy' ? (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={pharmacySearch}
                    onChange={(e) => setPharmacySearch(e.target.value)}
                    placeholder="Buscar farmácia..."
                    disabled={busy}
                    className={searchInputClassName}
                  />
                </div>
                {pharmaciesQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando farmácias…
                  </div>
                ) : null}
                {filteredPharmacies.length === 0 && !pharmaciesQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Nenhuma farmácia vinculada ao seu cadastro.</p>
                ) : (
                  <ul className="space-y-2">
                    {filteredPharmacies.map((p) => (
                      <li key={p.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setPharmacyId(p.id);
                            setDriverId(null);
                            setSectorId(null);
                            setDemandKey(null);
                            setPharmacySearch('');
                            setStep('driver');
                            setError(null);
                          }}
                          className={rowButtonClassName}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Building2 className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{p.trade_name}</div>
                            {pharmacySubtitle(p) ? (
                              <div className="truncate text-[11px] text-muted-foreground">{pharmacySubtitle(p)}</div>
                            ) : null}
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}

            {step === 'driver' ? (
              <>
                {selectedPharmacy ? (
                  <ContextBanner>
                    Farmácia: <span className="font-medium text-foreground">{selectedPharmacy.trade_name}</span>
                  </ContextBanner>
                ) : null}
                {driversQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando entregadores…
                  </div>
                ) : null}
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={driverSearch}
                    onChange={(e) => setDriverSearch(e.target.value)}
                    placeholder="Buscar entregador..."
                    disabled={busy}
                    className={searchInputClassName}
                  />
                </div>
                {driversAtPharmacy.length === 0 && !driversQuery.isLoading ? (
                  <div className="rounded-lg border border-border bg-background/30 p-4 text-center text-xs text-muted-foreground">
                    Nenhum entregador vinculado a essa farmácia.
                  </div>
                ) : filteredDriversAtPharmacy.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum entregador corresponde à busca.</p>
                ) : (
                  <ul className="space-y-2">
                    {filteredDriversAtPharmacy.map((d) => (
                      <li key={d.id}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDriverId(d.id);
                            setSectorId(null);
                            setDemandKey(null);
                            setStep('sector');
                          }}
                          className={rowButtonClassName}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-channel-whatsapp/10 text-channel-whatsapp">
                            <Bike className="h-4 w-4" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-sm font-medium">{d.name}</div>
                            {d.phone ? (
                              <div className="truncate text-[11px] text-muted-foreground">{d.phone}</div>
                            ) : null}
                          </div>
                          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setDriverId(null);
                    setSectorId(null);
                    setDemandKey(null);
                    setStep('sector');
                  }}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-border bg-background/20 px-3 py-2 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
                >
                  <SkipForward className="h-3.5 w-3.5" />
                  Pular — atendimento sem entregador específico
                </button>
              </>
            ) : null}

            {step === 'sector' ? (
              <>
                <ContextBanner>
                  {selectedPharmacy?.trade_name}
                  {selectedDriver ? (
                    <>
                      {' '}
                      · <span className="font-medium text-foreground">{selectedDriver.name}</span>
                    </>
                  ) : null}
                </ContextBanner>
                {sectorsQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando setores…
                  </div>
                ) : null}
                <ul className="grid gap-2 sm:grid-cols-2">
                  {sectors.map((s) => (
                    <li key={s.id}>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          setSectorId(s.id);
                          setDemandKey(null);
                          setStep('demand');
                        }}
                        className={rowButtonClassName}
                      >
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Layers className="h-4 w-4" />
                        </div>
                        <span className="text-sm font-medium">{s.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            {step === 'demand' ? (
              <>
                <ContextBanner>
                  {selectedPharmacy?.trade_name}
                  {selectedDriver ? <> · {selectedDriver.name}</> : null}
                  {selectedSector ? (
                    <>
                      {' '}
                      · <span className="font-medium text-foreground">{selectedSector.name}</span>
                    </>
                  ) : null}
                </ContextBanner>
                {demandsQuery.isLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Carregando demandas…
                  </div>
                ) : null}
                {(demandsQuery.data?.demands || []).length === 0 && !demandsQuery.isLoading ? (
                  <p className="text-sm text-muted-foreground">Nenhuma demanda configurada para este setor.</p>
                ) : (
                  <ul className="space-y-2">
                    {(demandsQuery.data?.demands || []).map((d) => (
                      <li key={d.demand_key}>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => {
                            setDemandKey(d.demand_key);
                            finishStart(d.demand_key);
                          }}
                          className={cn(rowButtonClassName, 'disabled:opacity-50')}
                        >
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <ListTodo className="h-4 w-4" />
                          </div>
                          <span className="flex-1 text-sm font-medium">{d.title}</span>
                          {busy && demandKey === d.demand_key ? (
                            <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                          ) : (
                            <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            ) : null}

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border px-5 py-3">
          <button
            type="button"
            onClick={goBack}
            disabled={busy}
            className="rounded-md border border-border bg-background/30 px-3 py-1.5 text-xs transition-colors hover:bg-sidebar-accent/60 disabled:opacity-50"
          >
            {step === 'pharmacy' ? 'Cancelar' : 'Voltar'}
          </button>
          <div className="text-[10px] text-muted-foreground">
            Etapa {stepIndex + 1} de {STEPS_ORDER.length}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { AlertTriangle, ChevronLeft, Send, UserX, X } from 'lucide-react';
import api from '@/lib/api';
import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';
import { leaderOccurrenceTypeLabel } from '@/lib/leaderPortal/leaderFinancialEntries';
import { formatBRL } from '@/lib/brFormat';
import { cn } from '@/lib/utils';
import {
  FormControl,
  formControlDateClassName,
  formTextareaClassName,
} from '@/components/form/FormControl';
import { CadastroDriverSearchCombobox } from '@/components/form/CadastroDriverSearchCombobox';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { OpsDriverSearchCombobox } from '@/components/operacao/OpsDriverSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import {
  defaultPharmacyIdsForOccurrenceDriver,
  pharmaciesForOccurrenceDriver,
  type OccurrenceDriverOption,
  OccurrenceKindConst,
  type OccurrenceKind,
  type OccurrencePayload,
  type OccurrencePharmacyOption,
  type OccurrenceShift,
} from '@/lib/occurrenceForm';

type Step = 'leader' | 'context' | 'type' | 'coverage' | 'reason' | 'summary';

const SHIFT_OPTIONS: { value: OccurrenceShift; label: string }[] = [
  { value: 'full', label: 'Dia inteiro' },
  { value: 'morning', label: 'Manhã' },
  { value: 'afternoon', label: 'Tarde' },
  { value: 'night', label: 'Noite' },
];

export type OccurrenceLeaderOption = { id: string; name: string };

export type OccurrenceWizardProps = {
  mode: 'leader' | 'financial' | 'attendant';
  drivers: OccurrenceDriverOption[];
  pharmacies: OccurrencePharmacyOption[];
  leaders?: OccurrenceLeaderOption[];
  initialLeaderId?: string;
  driversLoading?: boolean;
  pharmaciesLoading?: boolean;
  onSuccess?: () => void;
  onCancel?: () => void;
  layout?: 'embedded' | 'modal';
};

export function OccurrenceWizard({
  mode,
  drivers,
  pharmacies,
  leaders = [],
  initialLeaderId,
  driversLoading,
  pharmaciesLoading,
  onSuccess,
  onCancel,
  layout = 'embedded',
}: OccurrenceWizardProps) {
  const [step, setStep] = useState<Step>(mode === 'attendant' ? 'leader' : 'context');
  const [leaderId, setLeaderId] = useState(initialLeaderId || '');
  const [driverId, setDriverId] = useState('');
  const [pharmacyIds, setPharmacyIds] = useState<string[]>([]);
  const [eventDate, setEventDate] = useState(new Date().toISOString().slice(0, 10));
  const [shift, setShift] = useState<OccurrenceShift>('full');
  const [occurrenceKind, setOccurrenceKind] = useState<OccurrenceKind | null>(null);
  const [hasCoverage, setHasCoverage] = useState<boolean | null>(null);
  const [coveringDriverId, setCoveringDriverId] = useState('');
  const [coverageAmount, setCoverageAmount] = useState('');
  const [coverageNotes, setCoverageNotes] = useState('');
  const [reason, setReason] = useState('');
  const [searchedDriver, setSearchedDriver] = useState<OccurrenceDriverOption | null>(null);
  const [searchedCoveringDriver, setSearchedCoveringDriver] = useState<OccurrenceDriverOption | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [duplicateConfirmed, setDuplicateConfirmed] = useState(false);

  const useRemoteDriverSearch = mode === 'attendant' || mode === 'financial';

  const submitUrl =
    mode === 'leader'
      ? '/api/leader-portal/occurrences'
      : mode === 'attendant'
        ? '/api/ops-analytics/occurrences'
        : '/api/financial/occurrences';

  const stepSequence: Step[] =
    mode === 'attendant'
      ? ['leader', 'context', 'type', 'coverage', 'reason', 'summary']
      : ['context', 'type', 'coverage', 'reason', 'summary'];

  const selectedDriver = useMemo(
    () => searchedDriver || drivers.find((d) => d.id === driverId) || null,
    [drivers, driverId, searchedDriver]
  );

  const driverPharmacies = useMemo(
    () => pharmaciesForOccurrenceDriver(selectedDriver, pharmacies),
    [selectedDriver, pharmacies]
  );

  const coveringOptions = useMemo(
    () => drivers.filter((d) => d.id !== driverId),
    [drivers, driverId]
  );

  const primaryPharmacyId = pharmacyIds.filter(Boolean)[0] || '';

  const duplicateCheckQuery = useQuery({
    queryKey: ['leader-portal', 'duplicate-check', selectedDriver?.id, eventDate, primaryPharmacyId],
    queryFn: () =>
      leaderPortalPageApi.checkDuplicateOccurrences({
        driver_id: selectedDriver!.id,
        event_date: eventDate,
        pharmacy_id: primaryPharmacyId,
      }),
    enabled: mode === 'leader' && step === 'summary' && Boolean(selectedDriver?.id && primaryPharmacyId),
  });

  const duplicateEntries = duplicateCheckQuery.data?.duplicates || [];

  const createMutation = useMutation({
    mutationFn: async (payload: OccurrencePayload) =>
      (await api.post(submitUrl, payload)).data as Record<string, unknown>,
    onSuccess: () => {
      setStep(mode === 'attendant' ? 'leader' : 'context');
      setLeaderId(initialLeaderId || '');
      setDriverId('');
      setSearchedDriver(null);
      setSearchedCoveringDriver(null);
      setPharmacyIds([]);
      setOccurrenceKind(null);
      setHasCoverage(null);
      setCoveringDriverId('');
      setCoverageAmount('');
      setCoverageNotes('');
      setReason('');
      setDuplicateConfirmed(false);
      setError(null);
      onSuccess?.();
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg || 'Falha ao registrar ocorrência.');
    },
  });

  const isContractedDaily = occurrenceKind === OccurrenceKindConst.CONTRACTED_DAILY;

  const kindLabel =
    occurrenceKind === OccurrenceKindConst.DAY_OFF
      ? 'Folga'
      : occurrenceKind === OccurrenceKindConst.UNEXCUSED
        ? 'Falta'
        : isContractedDaily
          ? 'Diária contratada (trabalhou)'
          : '—';

  const coverageRoleLabel =
    occurrenceKind === OccurrenceKindConst.DAY_OFF
      ? 'Folguista'
      : occurrenceKind === OccurrenceKindConst.UNEXCUSED
        ? 'Diarista'
        : 'Cobridor';

  const submit = async () => {
    if (!selectedDriver || !occurrenceKind) return;
    if (!isContractedDaily && hasCoverage === null) return;
    const ids = pharmacyIds.filter(Boolean);
    if (!ids.length) return;
    setError(null);
    if (mode === 'attendant' && !leaderId) {
      setError('Selecione o líder que você está cobrindo.');
      return;
    }
    const amount = Number(coverageAmount.replace(',', '.'));
    if (isContractedDaily && !(amount > 0)) {
      setError('Informe o valor da diária contratada.');
      return;
    }
    if (mode === 'leader' && duplicateEntries.length > 0 && !duplicateConfirmed) {
      setError('Já existe lançamento em aberto para este entregador, data e farmácia. Confirme abaixo para continuar.');
      return;
    }
    const payload: OccurrencePayload = {
      driver_id: selectedDriver.id,
      pharmacy_ids: ids,
      event_date: eventDate,
      shift,
      occurrence_kind: occurrenceKind,
      has_coverage: isContractedDaily ? false : Boolean(hasCoverage),
      reason: reason.trim() || undefined,
      ...(mode === 'attendant' ? { on_behalf_of_leader_id: leaderId } : {}),
      coverage:
        !isContractedDaily && hasCoverage && coveringDriverId
          ? {
              covering_driver_id: coveringDriverId,
              amount: Number(coverageAmount.replace(',', '.')),
              notes: coverageNotes.trim() || undefined,
            }
          : undefined,
      contracted_daily: isContractedDaily
        ? {
            amount,
            notes: coverageNotes.trim() || undefined,
          }
        : undefined,
    };
    await createMutation.mutateAsync(payload);
  };

  function goBack() {
    setError(null);
    const idx = stepSequence.indexOf(step);
    if (idx > 0) setStep(stepSequence[idx - 1]!);
  }

  function goNextFromLeader() {
    if (!leaderId) {
      setError('Selecione o líder.');
      return;
    }
    setError(null);
    setStep('context');
  }

  const wizardBody = (
    <>
      <div className="flex gap-1">
        {stepSequence.map((s, i) => (
          <div
            key={s}
            className={cn(
              'h-1 flex-1 rounded-full',
              step === s || stepSequence.indexOf(step) > i ? 'bg-primary' : 'bg-border'
            )}
          />
        ))}
      </div>

      <div className={cn('rounded-xl border border-border bg-card p-6', layout === 'modal' && 'border-0 bg-transparent p-0')}>
        {step !== stepSequence[0] ? (
          <button
            type="button"
            onClick={goBack}
            className="mb-4 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Voltar
          </button>
        ) : null}

        {step === 'leader' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">Líder (cobertura)</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Selecione o líder ausente para o qual você está registrando a ocorrência.
            </p>
            <div>
              <label className="text-xs text-muted-foreground">Líder</label>
              <FormSearchCombobox
                value={leaderId}
                onChange={setLeaderId}
                className="mt-1"
                placeholder="Buscar líder…"
                options={leaders.map((l) => ({ value: l.id, label: l.name }))}
              />
            </div>
            <Button type="button" className="w-full" onClick={goNextFromLeader}>
              Continuar
            </Button>
          </div>
        ) : null}

        {step === 'context' ? (
          <div className="space-y-4">
            <div className="flex items-center gap-2">
              <UserX className="h-4 w-4 text-destructive" />
              <h3 className="text-sm font-semibold">Contexto</h3>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Entregador (ausente / de folga)</label>
              {useRemoteDriverSearch ? (
                mode === 'attendant' ? (
                  <OpsDriverSearchCombobox
                    scope="portfolio"
                    leaderId={leaderId || undefined}
                    value={driverId}
                    disabled={driversLoading || !leaderId}
                    onChange={(id) => {
                      setDriverId(id);
                      if (!id) setSearchedDriver(null);
                    }}
                    onDriverSelect={(driver) => {
                      setSearchedDriver(driver);
                      setPharmacyIds(defaultPharmacyIdsForOccurrenceDriver(driver, pharmacies));
                    }}
                    className="mt-1"
                    inputSize="md"
                    placeholder={
                      driversLoading
                        ? 'Carregando…'
                        : !leaderId
                          ? 'Selecione o líder primeiro'
                          : 'Buscar entregador…'
                    }
                    emptyLabel="Nenhum entregador na carteira"
                  />
                ) : (
                  <CadastroDriverSearchCombobox
                    value={driverId}
                    disabled={driversLoading}
                    onChange={(id) => {
                      setDriverId(id);
                      if (!id) setSearchedDriver(null);
                    }}
                    onDriverSelect={(driver) => {
                      setSearchedDriver(driver);
                      setPharmacyIds(defaultPharmacyIdsForOccurrenceDriver(driver, pharmacies));
                    }}
                    className="mt-1"
                    inputSize="md"
                    placeholder={driversLoading ? 'Carregando…' : 'Buscar entregador…'}
                  />
                )
              ) : (
                <FormSearchCombobox
                  value={driverId}
                  disabled={driversLoading}
                  onChange={(id) => {
                    setDriverId(id);
                    const driver = drivers.find((d) => d.id === id) || null;
                    setPharmacyIds(defaultPharmacyIdsForOccurrenceDriver(driver, pharmacies));
                  }}
                  className="mt-1"
                  placeholder={driversLoading ? 'Carregando…' : 'Buscar entregador…'}
                  options={drivers.map((d) => ({ value: d.id, label: d.name }))}
                />
              )}
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Farmácias</label>
              {selectedDriver && driverPharmacies.length ? (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {driverPharmacies.map((p) => {
                    const checked = pharmacyIds.includes(p.id);
                    return (
                      <label
                        key={p.id}
                        className={cn(
                          'flex cursor-pointer items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-xs',
                          checked && 'border-primary/40 bg-primary/5'
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) => {
                            const on = e.target.checked;
                            setPharmacyIds((curr) =>
                              on ? Array.from(new Set([...curr, p.id])) : curr.filter((x) => x !== p.id)
                            );
                          }}
                        />
                        <span className="truncate">{p.trade_name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-2 text-xs text-muted-foreground">
                  {pharmaciesLoading
                    ? 'Carregando farmácias…'
                    : 'Selecione o entregador e as farmácias vinculadas.'}
                </p>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label className="text-xs text-muted-foreground">Data do evento</label>
                <FormControl
                  type="date"
                  value={eventDate}
                  onChange={(e) => setEventDate(e.target.value)}
                  className={cn(formControlDateClassName, 'mt-1 w-full')}
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Turno</label>
                <FormSelect
                  value={shift}
                  onChange={(v) => setShift(v as OccurrenceShift)}
                  className="mt-1"
                  options={SHIFT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
                />
              </div>
            </div>
            <Button
              type="button"
              disabled={!driverId || pharmacyIds.length === 0}
              onClick={() => setStep('type')}
              className="w-full"
            >
              Continuar
            </Button>
          </div>
        ) : null}

        {step === 'type' ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Tipo de ocorrência</h3>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => {
                  setOccurrenceKind(OccurrenceKindConst.UNEXCUSED);
                  setHasCoverage(null);
                  setCoveringDriverId('');
                  setCoverageAmount('');
                  setCoverageNotes('');
                  setStep('coverage');
                }}
                className="rounded-xl border border-border bg-surface p-4 text-left hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="font-semibold">Falta</span>
                <p className="mt-1 text-xs text-muted-foreground">
                  Ausência não programada. Desconto definido no fechamento do ciclo.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOccurrenceKind(OccurrenceKindConst.DAY_OFF);
                  setHasCoverage(null);
                  setCoveringDriverId('');
                  setCoverageAmount('');
                  setCoverageNotes('');
                  setStep('coverage');
                }}
                className="rounded-xl border border-border bg-surface p-4 text-left hover:border-primary/40 hover:bg-primary/5"
              >
                <span className="font-semibold">Folga</span>
                <p className="mt-1 text-xs text-muted-foreground">
                  Dia sem escala. Registro informativo para conferência.
                </p>
              </button>
              <button
                type="button"
                onClick={() => {
                  setOccurrenceKind(OccurrenceKindConst.CONTRACTED_DAILY);
                  setHasCoverage(false);
                  setCoveringDriverId('');
                  setCoverageAmount('');
                  setCoverageNotes('');
                  setStep('coverage');
                }}
                className="rounded-xl border border-border bg-surface p-4 text-left hover:border-primary/40 hover:bg-primary/5 sm:col-span-2"
              >
                <span className="font-semibold">Diária contratada (trabalhou)</span>
                <p className="mt-1 text-xs text-muted-foreground">
                  O próprio entregador executou a diária contratada da farmácia — sem falta nem cobridor.
                </p>
              </button>
            </div>
          </div>
        ) : null}

        {step === 'coverage' && isContractedDaily ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Valor da diária</h3>
            <p className="text-xs text-muted-foreground">
              Informe o valor a pagar ao entregador selecionado. A diária segue para aprovação no Financeiro (PIX de
              terça).
            </p>
            <div>
              <label className="text-xs text-muted-foreground">Valor da diária (R$)</label>
              <FormControl
                type="text"
                inputMode="decimal"
                value={coverageAmount}
                onChange={(e) => setCoverageAmount(e.target.value)}
                placeholder="0,00"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Observações (opcional)</label>
              <FormControl
                value={coverageNotes}
                onChange={(e) => setCoverageNotes(e.target.value)}
                className="mt-1"
              />
            </div>
            <Button
              type="button"
              disabled={!Number(coverageAmount.replace(',', '.'))}
              onClick={() => setStep('reason')}
              className="w-full"
            >
              Continuar
            </Button>
          </div>
        ) : null}

        {step === 'coverage' && !isContractedDaily ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Cobertura</h3>
            <p className="text-xs text-muted-foreground">
              {occurrenceKind === OccurrenceKindConst.DAY_OFF
                ? 'Um folguista trabalhou no lugar do entregador de folga?'
                : 'Um diarista foi contratado para cobrir a falta?'}
            </p>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="rounded-xl border border-border bg-surface p-4 font-semibold hover:border-primary/40"
                onClick={() => setHasCoverage(true)}
              >
                Sim
              </button>
              <button
                type="button"
                className="rounded-xl border border-border bg-surface p-4 font-semibold hover:border-primary/40"
                onClick={() => {
                  setHasCoverage(false);
                  setStep('reason');
                }}
              >
                Não
              </button>
            </div>
            {hasCoverage ? (
              <div className="space-y-3 border-t border-border pt-4">
                <div>
                  <label className="text-xs text-muted-foreground">{coverageRoleLabel} que cobriu</label>
                  {useRemoteDriverSearch ? (
                    mode === 'attendant' ? (
                      <OpsDriverSearchCombobox
                        scope="portfolio"
                        leaderId={leaderId || undefined}
                        value={coveringDriverId}
                        disabled={!leaderId}
                        onChange={(id) => {
                          if (id && id === driverId) return;
                          setCoveringDriverId(id);
                          if (!id) setSearchedCoveringDriver(null);
                        }}
                        onDriverSelect={setSearchedCoveringDriver}
                        className="mt-1"
                        inputSize="md"
                        placeholder={!leaderId ? 'Selecione o líder primeiro' : 'Buscar entregador cobridor…'}
                        emptyLabel="Nenhum entregador na carteira"
                      />
                    ) : (
                      <CadastroDriverSearchCombobox
                        value={coveringDriverId}
                        onChange={(id) => {
                          if (id && id === driverId) return;
                          setCoveringDriverId(id);
                          if (!id) setSearchedCoveringDriver(null);
                        }}
                        onDriverSelect={setSearchedCoveringDriver}
                        className="mt-1"
                        inputSize="md"
                        placeholder="Buscar entregador cobridor…"
                      />
                    )
                  ) : (
                    <FormSearchCombobox
                      value={coveringDriverId}
                      onChange={setCoveringDriverId}
                      className="mt-1"
                      placeholder="Buscar entregador cobridor…"
                      options={coveringOptions.map((d) => ({ value: d.id, label: d.name }))}
                    />
                  )}
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Valor da diária (R$)</label>
                  <FormControl
                    type="text"
                    inputMode="decimal"
                    value={coverageAmount}
                    onChange={(e) => setCoverageAmount(e.target.value)}
                    placeholder="0,00"
                    className="mt-1"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground">Observações (opcional)</label>
                  <FormControl
                    value={coverageNotes}
                    onChange={(e) => setCoverageNotes(e.target.value)}
                    className="mt-1"
                  />
                </div>
                <Button
                  type="button"
                  disabled={!coveringDriverId || !Number(coverageAmount.replace(',', '.'))}
                  onClick={() => setStep('reason')}
                  className="w-full"
                >
                  Continuar
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        {step === 'reason' ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Motivo</h3>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder={
                isContractedDaily
                  ? 'Opcional: contexto da diária contratada…'
                  : occurrenceKind === OccurrenceKindConst.DAY_OFF
                    ? 'Opcional: motivo da folga…'
                    : 'Descreva o ocorrido…'
              }
              className={cn(formTextareaClassName)}
            />
            <div className="flex items-start gap-2 rounded-lg border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {isContractedDaily
                ? 'Gera uma diária para o próprio entregador, sem falta/folga nem cobridor. O financeiro aprova e o pagamento segue o ciclo de diárias (terça).'
                : occurrenceKind === OccurrenceKindConst.DAY_OFF
                  ? 'Folga é informativa — sem desconto. Se houver folguista, o financeiro aprova a diária de cobertura.'
                  : 'Falta segue para análise do financeiro: desconto (valor espelhado da diária, editável) ou abono. A diária do diarista é independente.'}
            </div>
            <Button type="button" onClick={() => setStep('summary')} className="w-full">
              Ver resumo
            </Button>
          </div>
        ) : null}

        {step === 'summary' ? (
          <div className="space-y-4">
            <h3 className="text-sm font-semibold">Resumo</h3>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Entregador</dt>
                <dd className="font-medium">{selectedDriver?.name}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Tipo</dt>
                <dd className="font-medium">{kindLabel}</dd>
              </div>
              <div className="flex justify-between gap-2">
                <dt className="text-muted-foreground">Data</dt>
                <dd className="font-medium">{eventDate}</dd>
              </div>
              {isContractedDaily ? (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Valor diária</dt>
                  <dd className="font-medium">R$ {coverageAmount}</dd>
                </div>
              ) : hasCoverage ? (
                <>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{coverageRoleLabel}</dt>
                    <dd className="font-medium">
                      {searchedCoveringDriver?.name ||
                        coveringOptions.find((d) => d.id === coveringDriverId)?.name ||
                        '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">Valor diária</dt>
                    <dd className="font-medium">R$ {coverageAmount}</dd>
                  </div>
                </>
              ) : (
                <div className="flex justify-between gap-2">
                  <dt className="text-muted-foreground">Cobertura</dt>
                  <dd className="font-medium">Não</dd>
                </div>
              )}
            </dl>
            {mode === 'leader' && duplicateEntries.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs">
                <div className="flex items-start gap-2 font-medium text-warning">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  Possível duplicata — já há lançamento em aberto para este entregador nesta data e farmácia:
                </div>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  {duplicateEntries.map((dup) => (
                    <li key={dup.id}>
                      {leaderOccurrenceTypeLabel(dup)} — {dup.leader_status_label} ({formatBRL(dup.amount)})
                    </li>
                  ))}
                </ul>
                <label className="flex items-start gap-2 pt-1">
                  <input
                    type="checkbox"
                    checked={duplicateConfirmed}
                    onChange={(e) => {
                      setDuplicateConfirmed(e.target.checked);
                      if (e.target.checked) setError(null);
                    }}
                    className="mt-0.5"
                  />
                  <span>Entendo e desejo registrar mesmo assim</span>
                </label>
              </div>
            ) : null}
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <button
              type="button"
              disabled={
                createMutation.isPending ||
                (mode === 'leader' && duplicateEntries.length > 0 && !duplicateConfirmed)
              }
              onClick={() => void submit()}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-destructive py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            >
              <Send className="h-4 w-4" /> Confirmar registro
            </button>
          </div>
        ) : null}
      </div>
    </>
  );

  if (layout === 'modal') {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
        <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-md">
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <h3 className="text-lg font-semibold tracking-tight">Ocorrências e lançamentos</h3>
              <p className="text-xs text-muted-foreground">
                Falta, folga, cobertura ou diária contratada (mesmo entregador).
              </p>
            </div>
            {onCancel ? (
              <button
                type="button"
                onClick={onCancel}
                className="rounded-full p-1 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            ) : null}
          </div>
          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">{wizardBody}</div>
        </div>
      </div>
    );
  }

  return <div className="mx-auto max-w-2xl space-y-4">{wizardBody}</div>;
}

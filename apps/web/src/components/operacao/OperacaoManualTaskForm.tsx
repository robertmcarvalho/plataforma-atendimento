'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Building2, Calendar, FileText, Plus, Truck, UserRound } from 'lucide-react';
import { CadastroField } from '@/components/cadastro/CadastroPrimitives';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { OpsDriverSearchCombobox } from '@/components/operacao/OpsDriverSearchCombobox';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { AutentiqueDocumentNameCopy } from '@/components/operacao/AutentiqueDocumentNameCopy';
import { Button } from '@/components/ui/button';
import {
  defaultPharmacyIdsForOccurrenceDriver,
  pharmaciesForOccurrenceDriver,
  resolveLeaderFromPharmacySelection,
  type OccurrenceDriverOption,
  type OccurrencePharmacyOption,
} from '@/lib/occurrenceForm';
import type { TerminationReason } from '@/components/cadastro/driver/DriverTerminationRequestForm';

const TERMINATION_REASONS = [
  { value: 'driver_request', label: 'Pedido do entregador' },
  { value: 'performance', label: 'Desempenho' },
  { value: 'absence', label: 'Ausência' },
  { value: 'route_ended', label: 'Encerramento de rota' },
  { value: 'other', label: 'Outro' },
] as const;

export function OperacaoManualTaskForm({
  taskType,
  driverId,
  onDriverIdChange,
  driverName,
  drivers,
  driversLoading,
  pharmacyIds,
  onPharmacyIdsChange,
  pharmacies,
  pharmaciesLoading,
  leaderName,
  lastWorkedAt,
  onLastWorkedAtChange,
  operationStartedAt,
  onOperationStartedAtChange,
  reason,
  onReasonChange,
  notes,
  onNotesChange,
  showAutentique,
  autentiqueVariant,
  ctxLoadError,
  error,
  onBack,
  onSubmit,
  submitting,
  submitLabel = 'Criar tarefa',
  driverSearchScope,
  driverSearchLeaderId,
  onDriverSelect,
}: {
  taskType?: string | null;
  driverId: string;
  onDriverIdChange: (id: string) => void;
  driverName: string;
  drivers: OccurrenceDriverOption[];
  driversLoading?: boolean;
  pharmacyIds: string[];
  onPharmacyIdsChange: (ids: string[]) => void;
  pharmacies: OccurrencePharmacyOption[];
  pharmaciesLoading?: boolean;
  leaderName?: string | null;
  lastWorkedAt?: string;
  onLastWorkedAtChange?: (value: string) => void;
  operationStartedAt?: string;
  onOperationStartedAtChange?: (value: string) => void;
  reason?: TerminationReason;
  onReasonChange?: (value: TerminationReason) => void;
  notes: string;
  onNotesChange: (value: string) => void;
  showAutentique?: boolean;
  autentiqueVariant?: 'MATRICULA' | 'DESLIGAMENTO';
  ctxLoadError?: string | null;
  error?: string | null;
  onBack: () => void;
  onSubmit: () => void;
  submitting?: boolean;
  submitLabel?: string;
  driverSearchScope?: 'ag' | 'portfolio';
  driverSearchLeaderId?: string;
  onDriverSelect?: (driver: OccurrenceDriverOption | null) => void;
}) {
  const [pharmacyToAdd, setPharmacyToAdd] = useState('');
  const [searchedDriver, setSearchedDriver] = useState<OccurrenceDriverOption | null>(null);

  const isTermination = taskType === 'driver_termination_prep';
  const isEnrollment = taskType === 'driver_enrollment_prep';

  const driverOptions = drivers.map((d) => ({ value: d.id, label: d.name }));

  const selectedDriver = useMemo(
    () => searchedDriver || drivers.find((d) => d.id === driverId) || null,
    [drivers, driverId, searchedDriver]
  );

  const selectedDriverName = driverName || selectedDriver?.name || '';

  const linkedPharmacies = useMemo(
    () => pharmaciesForOccurrenceDriver(selectedDriver, pharmacies),
    [selectedDriver, pharmacies]
  );

  const selectedPharmacies = useMemo(
    () => pharmacies.filter((p) => pharmacyIds.includes(p.id)),
    [pharmacies, pharmacyIds]
  );

  const handleDriverSelect = useCallback(
    (driver: OccurrenceDriverOption | null) => {
      setSearchedDriver(driver);
      onDriverSelect?.(driver);
      onPharmacyIdsChange(defaultPharmacyIdsForOccurrenceDriver(driver, pharmacies));
      setPharmacyToAdd('');
    },
    [onDriverSelect, onPharmacyIdsChange, pharmacies]
  );

  const handleDriverChange = useCallback(
    (id: string) => {
      onDriverIdChange(id);
      if (!id) handleDriverSelect(null);
    },
    [onDriverIdChange, handleDriverSelect]
  );

  useEffect(() => {
    if (!driverId || pharmacyIds.length) return;
    const driver =
      searchedDriver?.id === driverId
        ? searchedDriver
        : drivers.find((d) => d.id === driverId) || null;
    const defaults = defaultPharmacyIdsForOccurrenceDriver(driver, pharmacies);
    if (defaults.length) onPharmacyIdsChange(defaults);
  }, [driverId, drivers, searchedDriver, pharmacies, pharmacyIds.length, onPharmacyIdsChange]);

  const addablePharmacies = linkedPharmacies.filter((p) => !pharmacyIds.includes(p.id));

  const canSubmit =
    Boolean(driverId) &&
    !submitting &&
    (!isTermination || Boolean(lastWorkedAt && reason)) &&
    (!isEnrollment || Boolean(operationStartedAt));

  return (
    <div className="space-y-4">
      {ctxLoadError ? <p className="text-xs text-destructive">{ctxLoadError}</p> : null}

      <CadastroField icon={Truck} label="Entregador" required>
        {driverSearchScope ? (
          <OpsDriverSearchCombobox
            scope={driverSearchScope}
            leaderId={driverSearchLeaderId}
            value={driverId}
            onChange={handleDriverChange}
            onDriverSelect={handleDriverSelect}
            disabled={driversLoading}
            placeholder={driversLoading ? 'Carregando…' : 'Buscar entregador…'}
            emptyLabel={
              driverSearchScope === 'portfolio'
                ? 'Nenhum entregador na carteira'
                : 'Nenhum entregador encontrado'
            }
          />
        ) : (
          <FormSearchCombobox
            value={driverId}
            onChange={handleDriverChange}
            inputSize="lg"
            disabled={driversLoading}
            placeholder={driversLoading ? 'Carregando…' : 'Buscar entregador…'}
            options={driverOptions}
            emptyLabel="Nenhum entregador na carteira"
          />
        )}
      </CadastroField>

      {driverId ? (
        <>
          <CadastroField icon={Building2} label="Farmácias vinculadas">
            {selectedPharmacies.length > 0 ? (
              <ul className="space-y-1 text-xs">
                {selectedPharmacies.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-md border border-border px-2 py-1.5"
                  >
                    <span>{p.trade_name}</span>
                    {selectedPharmacies.length > 1 ? (
                      <button
                        type="button"
                        className="text-destructive"
                        onClick={() => onPharmacyIdsChange(pharmacyIds.filter((id) => id !== p.id))}
                      >
                        Remover
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted-foreground">Nenhuma farmácia vinculada a este entregador.</p>
            )}
          </CadastroField>

          {addablePharmacies.length > 0 ? (
            <CadastroField icon={Building2} label="Adicionar farmácia vinculada">
              <div className="flex gap-2">
                <FormSearchCombobox
                  value={pharmacyToAdd}
                  onChange={setPharmacyToAdd}
                  inputSize="lg"
                  className="min-w-0 flex-1"
                  disabled={pharmaciesLoading}
                  placeholder={pharmaciesLoading ? 'Carregando…' : 'Buscar farmácia…'}
                  options={addablePharmacies.map((p) => ({ value: p.id, label: p.trade_name }))}
                />
                <button
                  type="button"
                  onClick={() => {
                    if (!pharmacyToAdd || pharmacyIds.includes(pharmacyToAdd)) return;
                    onPharmacyIdsChange([...pharmacyIds, pharmacyToAdd]);
                    setPharmacyToAdd('');
                  }}
                  className="inline-flex h-10 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground"
                >
                  <Plus className="h-3.5 w-3.5" /> Vincular
                </button>
              </div>
            </CadastroField>
          ) : null}

          <CadastroField icon={UserRound} label="Líder vinculado">
            <FormControl
              inputSize="lg"
              readOnly
              value={leaderName || '—'}
              placeholder="Selecione o entregador e as farmácias"
            />
          </CadastroField>

          {isTermination && onLastWorkedAtChange ? (
            <>
              <CadastroField icon={Calendar} label="Último dia trabalhado" required>
                <FormControl
                  inputSize="lg"
                  type="date"
                  value={lastWorkedAt || ''}
                  onChange={(e) => onLastWorkedAtChange(e.target.value)}
                />
              </CadastroField>
              {onReasonChange ? (
                <CadastroField icon={FileText} label="Motivo" required>
                  <FormSelect
                    value={reason || 'driver_request'}
                    onChange={(v) => onReasonChange(v as TerminationReason)}
                    size="lg"
                    options={TERMINATION_REASONS.map((r) => ({ value: r.value, label: r.label }))}
                  />
                </CadastroField>
              ) : null}
            </>
          ) : null}

          {isEnrollment && onOperationStartedAtChange ? (
            <CadastroField icon={Calendar} label="Data que iniciou a operar" required>
              <FormControl
                inputSize="lg"
                type="date"
                value={operationStartedAt || ''}
                onChange={(e) => onOperationStartedAtChange(e.target.value)}
              />
            </CadastroField>
          ) : null}
        </>
      ) : (
        <CadastroField icon={Building2} label="Farmácias">
          <p className="text-xs text-muted-foreground">
            Selecione o entregador para carregar as farmácias vinculadas.
          </p>
        </CadastroField>
      )}

      {showAutentique && driverId && selectedDriverName ? (
        <AutentiqueDocumentNameCopy
          driverId={driverId}
          driverName={selectedDriverName}
          variant={autentiqueVariant || 'MATRICULA'}
        />
      ) : null}

      <CadastroField icon={FileText} label="Observações (opcional)">
        <textarea
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          rows={3}
          className={formTextareaClassName}
          placeholder="Contexto da demanda…"
        />
      </CadastroField>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex gap-2 pt-1">
        <Button type="button" variant="outline" className="flex-1" onClick={onBack}>
          Voltar
        </Button>
        <Button type="button" className="flex-1" disabled={!canSubmit} onClick={onSubmit}>
          {submitting ? 'Criando…' : submitLabel}
        </Button>
      </div>
    </div>
  );
}

export function useOperacaoManualTaskLeader(
  driverId: string,
  pharmacyIds: string[],
  drivers: OccurrenceDriverOption[],
  pharmacies: OccurrencePharmacyOption[]
) {
  return useMemo(() => {
    const driver = drivers.find((d) => d.id === driverId) || null;
    return resolveLeaderFromPharmacySelection(pharmacyIds, pharmacies, driver);
  }, [driverId, pharmacyIds, drivers, pharmacies]);
}

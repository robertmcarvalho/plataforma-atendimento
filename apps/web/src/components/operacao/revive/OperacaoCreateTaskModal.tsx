'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ClipboardPlus } from 'lucide-react';
import {
  OperacaoManualTaskForm,
  useOperacaoManualTaskLeader,
} from '@/components/operacao/OperacaoManualTaskForm';
import type { TerminationReason } from '@/components/cadastro/driver/DriverTerminationRequestForm';
import { OperacaoModalShell } from '@/components/operacao/OperacaoModalShell';
import { taskMetaForType } from '@/lib/operacao/operacaoTaskMeta';
import {
  createOperacaoTask,
  fetchPortfolioLaunchContext,
  fetchTaskLaunchContext,
} from '@/lib/ops/opsAnalyticsApi';
import { cn } from '@/lib/utils';
import { reviveListCardClassName } from '@/lib/reviveSurfaces';
import type { OccurrenceDriverOption } from '@/lib/occurrenceForm';

function apiErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    return String(
      (err as { response?: { data?: { error?: string } } }).response?.data?.error || fallback
    );
  }
  return fallback;
}

export function OperacaoCreateTaskModal({
  open,
  onClose,
  scope,
  initialTaskType,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  scope: 'ag' | 'portfolio';
  analystMode?: boolean;
  /** Pula a etapa de escolha do tipo (ações rápidas AG). */
  initialTaskType?: string | null;
  onCreated: (taskId: string, deepLink: string) => void;
}) {
  const [step, setStep] = useState<'pick' | 'form'>('pick');
  const [taskType, setTaskType] = useState<string | null>(null);
  const [driverId, setDriverId] = useState('');
  const [pharmacyIds, setPharmacyIds] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [lastWorkedAt, setLastWorkedAt] = useState(new Date().toISOString().slice(0, 10));
  const [operationStartedAt, setOperationStartedAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<TerminationReason>('driver_request');
  const [selectedDriver, setSelectedDriver] = useState<OccurrenceDriverOption | null>(null);
  const [error, setError] = useState<string | null>(null);

  const typesQuery = useQuery({
    queryKey: ['ops-analytics', 'task-launch-context', scope, 'types'],
    queryFn: () => fetchTaskLaunchContext(scope),
    enabled: open,
    retry: false,
  });

  const portfolioCtxQuery = useQuery({
    queryKey: ['ops-analytics', 'launch-context', 'manual-task'],
    queryFn: () => fetchPortfolioLaunchContext(),
    enabled: open && step === 'form' && scope === 'portfolio',
  });

  const agCtxQuery = useQuery({
    queryKey: ['ops-analytics', 'task-launch-context', scope, 'form'],
    queryFn: () => fetchTaskLaunchContext(scope),
    enabled: open && step === 'form' && scope === 'ag',
    retry: false,
  });

  const launchCtx = scope === 'portfolio' ? portfolioCtxQuery.data : agCtxQuery.data;
  const launchLoading = scope === 'portfolio' ? portfolioCtxQuery.isLoading : agCtxQuery.isLoading;
  const launchError = scope === 'portfolio' ? portfolioCtxQuery : agCtxQuery;

  const manualTypes = typesQuery.data?.manual_task_types || [];
  const typesLoadError = typesQuery.isError
    ? apiErrorMessage(typesQuery.error, 'Não foi possível carregar os tipos de tarefa.')
    : null;

  const ctxLoadError =
    launchError.isError && step === 'form'
      ? apiErrorMessage(
          launchError.error,
          scope === 'portfolio'
            ? 'Não foi possível carregar entregadores da carteira.'
            : 'Não foi possível carregar entregadores do setor.'
        )
      : null;

  const drivers = useMemo(
    (): OccurrenceDriverOption[] =>
      (launchCtx?.drivers || []).map((d) => ({
        id: d.id,
        name: d.name,
        primary_pharmacy_id: d.primary_pharmacy_id,
        leader_linked_pharmacy_ids: d.leader_linked_pharmacy_ids,
      })),
    [launchCtx?.drivers]
  );

  const pharmacies = useMemo(
    () =>
      (launchCtx?.pharmacies || []).map((p) => ({
        id: p.id,
        trade_name: p.trade_name,
        leader_id: p.leader_id ?? null,
        leader_name: p.leader_name ?? null,
      })),
    [launchCtx?.pharmacies]
  );

  const driversForLeader = useMemo((): OccurrenceDriverOption[] => {
    if (!selectedDriver) return drivers;
    if (drivers.some((d) => d.id === selectedDriver.id)) return drivers;
    return [...drivers, selectedDriver];
  }, [drivers, selectedDriver]);

  const selectedMeta = taskType ? taskMetaForType(taskType) : null;
  const driverName = selectedDriver?.name || drivers.find((d) => d.id === driverId)?.name || '';
  const { leaderId, leaderName } = useOperacaoManualTaskLeader(
    driverId,
    pharmacyIds,
    driversForLeader,
    pharmacies
  );

  const showAutentique =
    taskType === 'driver_enrollment_prep' || taskType === 'driver_termination_prep';
  const autentiqueVariant =
    taskType === 'driver_enrollment_prep'
      ? ('MATRICULA' as const)
      : taskType === 'driver_termination_prep'
        ? ('DESLIGAMENTO' as const)
        : undefined;

  const createMutation = useMutation({
    mutationFn: () =>
      createOperacaoTask({
        task_type: taskType!,
        driver_id: driverId,
        pharmacy_id: pharmacyIds[0] || undefined,
        leader_id: leaderId || undefined,
        notes: notes.trim() || undefined,
        last_worked_at:
          taskType === 'driver_termination_prep' ? lastWorkedAt : undefined,
        operation_started_at:
          taskType === 'driver_enrollment_prep' ? operationStartedAt : undefined,
        reason: taskType === 'driver_termination_prep' ? reason : undefined,
        scope,
      }),
    onSuccess: (data) => {
      reset();
      onClose();
      onCreated(data.task_id, data.deep_link);
    },
    onError: (e: unknown) => setError(apiErrorMessage(e, 'Erro ao criar tarefa')),
  });

  const reset = () => {
    setStep('pick');
    setTaskType(null);
    setDriverId('');
    setSelectedDriver(null);
    setPharmacyIds([]);
    setNotes('');
    setLastWorkedAt(new Date().toISOString().slice(0, 10));
    setOperationStartedAt(new Date().toISOString().slice(0, 10));
    setReason('driver_request');
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  useEffect(() => {
    if (!open) return;
    if (initialTaskType && manualTypes.some((t) => t.task_type === initialTaskType)) {
      setTaskType(initialTaskType);
      setStep('form');
      setError(null);
    } else if (!initialTaskType) {
      setStep('pick');
      setTaskType(null);
    }
  }, [open, initialTaskType, manualTypes]);

  if (!open) return null;

  return (
    <OperacaoModalShell
      open={open}
      onClose={handleClose}
      title={step === 'pick' ? 'Nova tarefa' : selectedMeta?.label || 'Nova tarefa'}
      subtitle={step === 'pick' ? 'Selecione o tipo de tarefa' : 'Preencha os dados do entregador'}
      icon={step === 'pick' ? ClipboardPlus : selectedMeta?.icon || ClipboardPlus}
      tone={step === 'pick' ? 'primary' : selectedMeta?.tone || 'primary'}
    >
      {step === 'pick' ? (
        <div className="space-y-2">
          {typesLoadError ? <p className="text-xs text-destructive">{typesLoadError}</p> : null}
          {typesQuery.isLoading ? (
            <p className="text-xs text-muted-foreground">Carregando tipos de tarefa…</p>
          ) : null}
          {!typesQuery.isLoading && manualTypes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhum tipo habilitado para criação manual.</p>
          ) : null}
          {manualTypes.map((k) => {
            const meta = taskMetaForType(k.task_type);
            const KindIcon = meta.icon;
            return (
              <button
                key={k.task_type}
                type="button"
                onClick={() => {
                  setTaskType(k.task_type);
                  setStep('form');
                  setError(null);
                }}
                className={cn(
                  'flex w-full items-center gap-3 p-3 text-left',
                  reviveListCardClassName,
                  taskType === k.task_type && 'border-primary bg-primary/5'
                )}
              >
                <KindIcon className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.75} />
                <span className="text-sm font-medium">{k.label}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <OperacaoManualTaskForm
          taskType={taskType}
          driverId={driverId}
          onDriverIdChange={setDriverId}
          driverName={driverName}
          drivers={drivers}
          driversLoading={launchLoading}
          driverSearchScope={scope}
          onDriverSelect={setSelectedDriver}
          pharmacyIds={pharmacyIds}
          onPharmacyIdsChange={setPharmacyIds}
          pharmacies={pharmacies}
          pharmaciesLoading={launchLoading}
          leaderName={leaderName}
          lastWorkedAt={lastWorkedAt}
          onLastWorkedAtChange={setLastWorkedAt}
          operationStartedAt={operationStartedAt}
          onOperationStartedAtChange={setOperationStartedAt}
          reason={reason}
          onReasonChange={setReason}
          notes={notes}
          onNotesChange={setNotes}
          showAutentique={showAutentique}
          autentiqueVariant={autentiqueVariant}
          ctxLoadError={ctxLoadError}
          error={error}
          onBack={() => {
            if (initialTaskType) {
              handleClose();
              return;
            }
            setStep('pick');
            setTaskType(null);
            setDriverId('');
            setPharmacyIds([]);
            setNotes('');
            setError(null);
          }}
          onSubmit={() => {
            setError(null);
            createMutation.mutate();
          }}
          submitting={createMutation.isPending}
        />
      )}
    </OperacaoModalShell>
  );
}

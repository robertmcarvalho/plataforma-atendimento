'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { UserPlus, UserX } from 'lucide-react';
import { OperacaoModalShell } from '@/components/operacao/OperacaoModalShell';
import { Button } from '@/components/ui/button';
import { DriverWorkScheduleEditor } from '@/components/cadastro/DriverWorkScheduleEditor';
import { DriverPreCadastroForm } from '@/components/cadastro/driver/DriverPreCadastroForm';
import { serializeWorkScheduleForApi } from '@/components/settings/BusinessHoursEditor';
import {
  DriverTerminationRequestForm,
  type TerminationReason,
} from '@/components/cadastro/driver/DriverTerminationRequestForm';
import {
  createOpsPreRegistration,
  createOpsTerminationRequest,
  fetchPortfolioLaunchContext,
} from '@/lib/ops/opsAnalyticsApi';

export function DriverPreCadastroModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [leaderId, setLeaderId] = useState('');
  const [name, setName] = useState('');
  const [cpf, setCpf] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [city, setCity] = useState('');
  const [state, setState] = useState('');
  const [driverType, setDriverType] = useState<'fixed' | 'daily'>('fixed');
  const [pharmacyIds, setPharmacyIds] = useState<string[]>([]);
  const [primaryPharmacyId, setPrimaryPharmacyId] = useState('');
  const [pharmacyToAdd, setPharmacyToAdd] = useState('');
  const [notes, setNotes] = useState('');
  const [workSchedule, setWorkSchedule] = useState<Record<string, unknown>>({});
  const [error, setError] = useState<string | null>(null);

  const ctxQuery = useQuery({
    queryKey: ['ops-analytics', 'launch-context', leaderId || 'all'],
    queryFn: () => fetchPortfolioLaunchContext(leaderId || undefined),
    enabled: open,
  });

  const leaderPharmacies = useMemo(() => {
    const leaders = ctxQuery.data?.leaders || [];
    const allPharmacies = ctxQuery.data?.pharmacies || [];
    if (!leaderId) return [];
    const leader = leaders.find((l) => l.id === leaderId);
    if (!leader?.pharmacy_ids?.length) return allPharmacies;
    const allowed = new Set(leader.pharmacy_ids);
    return allPharmacies.filter((p) => allowed.has(p.id));
  }, [ctxQuery.data, leaderId]);

  useEffect(() => {
    setPharmacyIds([]);
    setPrimaryPharmacyId('');
    setPharmacyToAdd('');
  }, [leaderId]);

  const ctxLoadError =
    ctxQuery.isError && ctxQuery.error
      ? ctxQuery.error && typeof ctxQuery.error === 'object' && 'response' in ctxQuery.error
        ? String(
            (ctxQuery.error as { response?: { data?: { error?: string } } }).response?.data?.error ||
              'Não foi possível carregar líderes e entregadores da carteira.'
          )
        : 'Não foi possível carregar líderes e entregadores da carteira.'
      : null;

  const mutation = useMutation({
    mutationFn: () =>
      createOpsPreRegistration({
        on_behalf_of_leader_id: leaderId,
        name: name.trim(),
        cpf: cpf || null,
        phone,
        email: email || null,
        city: city || null,
        state: state || null,
        driver_type: driverType,
        work_schedule: serializeWorkScheduleForApi(workSchedule),
        pharmacy_ids: pharmacyIds,
        primary_pharmacy_id: primaryPharmacyId || pharmacyIds[0],
        notes: notes || null,
      }),
    onSuccess: () => {
      onSuccess?.();
      onClose();
      setError(null);
    },
    onError: (e: unknown) => {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? String((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Erro')
          : 'Erro ao enviar pré-cadastro';
      setError(msg);
    },
  });

  const canSubmit = Boolean(leaderId && name.trim() && phone && pharmacyIds.length && !mutation.isPending);

  return (
    <OperacaoModalShell open={open} onClose={onClose} title="Pré-cadastro de entregador" icon={UserPlus} tone="primary">
      <DriverPreCadastroForm
        showLeaderPicker
        leaderId={leaderId}
        onLeaderIdChange={setLeaderId}
        leaders={(ctxQuery.data?.leaders || []).map((l) => ({ id: l.id, name: l.name }))}
        name={name}
        onNameChange={setName}
        cpf={cpf}
        onCpfChange={setCpf}
        phone={phone}
        onPhoneChange={setPhone}
        email={email}
        onEmailChange={setEmail}
        city={city}
        onCityChange={setCity}
        state={state}
        onStateChange={setState}
        driverType={driverType}
        onDriverTypeChange={setDriverType}
        pharmacyIds={pharmacyIds}
        onPharmacyIdsChange={setPharmacyIds}
        primaryPharmacyId={primaryPharmacyId}
        onPrimaryPharmacyIdChange={setPrimaryPharmacyId}
        pharmacyToAdd={pharmacyToAdd}
        onPharmacyToAddChange={setPharmacyToAdd}
        pharmacies={leaderPharmacies}
        pharmaciesLoading={ctxQuery.isLoading}
        notes={notes}
        onNotesChange={setNotes}
      />
      <div className="rounded-xl border border-border bg-background/40 p-4">
        <p className="mb-2 text-xs font-semibold">Escala de trabalho</p>
        <p className="mb-3 text-[11px] text-muted-foreground">Turnos por dia, feriados e exceções (opcional).</p>
        <DriverWorkScheduleEditor value={workSchedule} onChange={setWorkSchedule} />
      </div>
      {ctxLoadError ? <p className="text-xs text-destructive">{ctxLoadError}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="button" className="w-full" disabled={!canSubmit} onClick={() => mutation.mutate()}>
        {mutation.isPending ? 'Enviando…' : 'Enviar pré-cadastro'}
      </Button>
    </OperacaoModalShell>
  );
}

export function DriverTerminationRequestModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}) {
  const [leaderId, setLeaderId] = useState('');
  const [driverId, setDriverId] = useState('');
  const [lastWorkedAt, setLastWorkedAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<TerminationReason>('driver_request');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  const ctxQuery = useQuery({
    queryKey: ['ops-analytics', 'launch-context', leaderId || 'all'],
    queryFn: () => fetchPortfolioLaunchContext(leaderId || undefined),
    enabled: open,
  });

  useEffect(() => {
    setDriverId('');
  }, [leaderId]);

  const leaderDrivers = useMemo(() => {
    if (!leaderId) return [];
    return (ctxQuery.data?.drivers || []).map((d) => ({ id: d.id, name: d.name }));
  }, [ctxQuery.data, leaderId]);

  const ctxLoadError =
    ctxQuery.isError && ctxQuery.error
      ? ctxQuery.error && typeof ctxQuery.error === 'object' && 'response' in ctxQuery.error
        ? String(
            (ctxQuery.error as { response?: { data?: { error?: string } } }).response?.data?.error ||
              'Não foi possível carregar líderes e entregadores da carteira.'
          )
        : 'Não foi possível carregar líderes e entregadores da carteira.'
      : null;

  const mutation = useMutation({
    mutationFn: () =>
      createOpsTerminationRequest({
        on_behalf_of_leader_id: leaderId,
        driver_id: driverId,
        last_worked_at: lastWorkedAt,
        reason,
        notes: notes || null,
      }),
    onSuccess: () => {
      onSuccess?.();
      onClose();
      setError(null);
    },
    onError: (e: unknown) => {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? String((e as { response?: { data?: { error?: string } } }).response?.data?.error || 'Erro')
          : 'Erro ao solicitar desligamento';
      setError(msg);
    },
  });

  const canSubmit = Boolean(leaderId && driverId && lastWorkedAt && !mutation.isPending);

  return (
    <OperacaoModalShell open={open} onClose={onClose} title="Solicitar desligamento" icon={UserX} tone="destructive">
      <DriverTerminationRequestForm
        showLeaderPicker
        leaderId={leaderId}
        onLeaderIdChange={setLeaderId}
        leaders={(ctxQuery.data?.leaders || []).map((l) => ({ id: l.id, name: l.name }))}
        driverId={driverId}
        onDriverIdChange={setDriverId}
        drivers={leaderDrivers}
        driversLoading={ctxQuery.isLoading}
        driverSearchScope="portfolio"
        lastWorkedAt={lastWorkedAt}
        onLastWorkedAtChange={setLastWorkedAt}
        reason={reason}
        onReasonChange={setReason}
        notes={notes}
        onNotesChange={setNotes}
      />
      {ctxLoadError ? <p className="text-xs text-destructive">{ctxLoadError}</p> : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Button type="button" className="w-full" disabled={!canSubmit} onClick={() => mutation.mutate()}>
        {mutation.isPending ? 'Enviando…' : 'Solicitar desligamento'}
      </Button>
    </OperacaoModalShell>
  );
}

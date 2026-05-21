'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Building2, Calendar, CheckCircle2, Loader2, Send, Truck, UserX } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { CadastroField, CadastroPageScroll, CadastroSection } from '@/components/cadastro/CadastroPrimitives';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';

type Driver = {
  id: string;
  name: string;
  phone?: string | null;
  primary_pharmacy_id?: string | null;
  primary_pharmacy?: { trade_name: string } | null;
  leader_linked_pharmacy_ids?: string[];
};

type Pharmacy = { id: string; trade_name: string; city?: string | null };

type TerminationTask = {
  id: string;
  task_type: string;
  title: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  created_at?: string | null;
  metadata?: {
    request_id?: string;
    last_worked_at?: string;
    reason?: string;
    sector_action?: string;
  };
  driver?: { id: string; name: string; phone?: string | null; status?: string | null } | null;
};

const REASONS = [
  { value: 'driver_request', label: 'Pedido do entregador' },
  { value: 'performance', label: 'Desempenho' },
  { value: 'absence', label: 'Ausência' },
  { value: 'route_ended', label: 'Encerramento de rota' },
  { value: 'other', label: 'Outro' },
] as const;

function statusLabel(status: TerminationTask['status']) {
  switch (status) {
    case 'done':
      return 'aprovada';
    case 'cancelled':
      return 'cancelada';
    case 'in_progress':
      return 'em análise';
    default:
      return 'aberta';
  }
}

export default function LiderDesligamentoPage() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [driverId, setDriverId] = useState('');
  const [lastWorkedAt, setLastWorkedAt] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<(typeof REASONS)[number]['value']>('driver_request');
  const [notes, setNotes] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const driversQuery = useQuery<Driver[]>({
    queryKey: ['leader-portal', 'drivers'],
    queryFn: async () => (await api.get('/api/leader-portal/drivers')).data as Driver[],
    enabled: user?.role === 'leader',
  });

  const pharmaciesQuery = useQuery<Pharmacy[]>({
    queryKey: ['leader-portal', 'pharmacies'],
    queryFn: async () => (await api.get('/api/leader-portal/pharmacies')).data as Pharmacy[],
    enabled: user?.role === 'leader',
  });

  const requestsQuery = useQuery<TerminationTask[]>({
    queryKey: ['leader-portal', 'termination-requests'],
    queryFn: async () => (await api.get('/api/leader-portal/termination-requests')).data as TerminationTask[],
    enabled: user?.role === 'leader',
  });

  const selectedDriver = useMemo(
    () => (driversQuery.data || []).find((d) => d.id === driverId) || null,
    [driversQuery.data, driverId]
  );

  const driverPharmacies = useMemo(() => {
    const all = pharmaciesQuery.data || [];
    const ids = new Set((selectedDriver?.leader_linked_pharmacy_ids || []).filter(Boolean));
    return all.filter((p) => ids.has(p.id));
  }, [pharmaciesQuery.data, selectedDriver?.leader_linked_pharmacy_ids]);

  useEffect(() => {
    setMessage(null);
  }, [driverId, lastWorkedAt, reason, notes]);

  const createMutation = useMutation({
    mutationFn: async (payload: {
      driver_id: string;
      last_worked_at: string;
      reason: string;
      notes?: string | null;
    }) => (await api.post('/api/leader-portal/termination-requests', payload)).data,
    onSuccess: async () => {
      setMessage('Solicitação de desligamento enviada para Operacional e Financeiro.');
      setDriverId('');
      setLastWorkedAt(new Date().toISOString().slice(0, 10));
      setReason('driver_request');
      setNotes('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['leader-portal', 'termination-requests'] }),
        qc.invalidateQueries({ queryKey: ['leader-portal', 'drivers'] }),
      ]);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setMessage(msg || 'Não foi possível enviar a solicitação.');
    },
  });

  const canSubmit = Boolean(selectedDriver && lastWorkedAt && reason && !createMutation.isPending);

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Desligamento" description="Esta área é exclusiva para perfis de líder." />
        <Link className="button-secondary" href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <CadastroPageScroll maxWidthClassName="max-w-6xl">
      <PageHeader
        eyebrow="Operação"
        title="Desligamento"
        description="Solicite o desligamento de um entregador para análise do Operacional e Financeiro."
        actions={
          <Link href="/lider" className="button-secondary">
            <ArrowLeft className="h-4 w-4" />
            Voltar
          </Link>
        }
      />

      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <CadastroSection title="Nova solicitação" desc="O desligamento só será aplicado após aprovação operacional.">
            <div className="grid gap-4 md:grid-cols-2">
              <CadastroField icon={Truck} label="Entregador" required>
                <select
                  value={driverId}
                  onChange={(e) => setDriverId(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
                >
                  <option value="">{driversQuery.isLoading ? 'Carregando…' : 'Selecione…'}</option>
                  {(driversQuery.data || []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </select>
              </CadastroField>

              <CadastroField icon={Calendar} label="Último dia trabalhado" required>
                <input
                  type="date"
                  value={lastWorkedAt}
                  onChange={(e) => setLastWorkedAt(e.target.value)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
                />
              </CadastroField>

              <CadastroField icon={UserX} label="Motivo" required>
                <select
                  value={reason}
                  onChange={(e) => setReason(e.target.value as typeof reason)}
                  className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/50"
                >
                  {REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </CadastroField>
            </div>

            <CadastroField icon={Building2} label="Farmácias vinculadas">
              {!selectedDriver ? (
                <div className="rounded-md border border-dashed border-border bg-background px-3 py-4 text-sm text-muted-foreground">
                  Selecione um entregador para listar as farmácias vinculadas.
                </div>
              ) : driverPharmacies.length ? (
                <div className="grid gap-2 sm:grid-cols-2">
                  {driverPharmacies.map((p) => (
                    <div key={p.id} className="rounded-md border border-border bg-background px-3 py-2">
                      <div className="flex items-center gap-2 text-xs font-medium">
                        <Building2 className="h-3.5 w-3.5 text-primary" />
                        <span className="truncate">{p.trade_name}</span>
                      </div>
                      {p.city ? <div className="mt-0.5 text-[10px] text-muted-foreground">{p.city}</div> : null}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rounded-md border border-border bg-background px-3 py-4 text-sm text-muted-foreground">
                  Nenhuma farmácia vinculada encontrada.
                </div>
              )}
            </CadastroField>

            <CadastroField icon={AlertTriangle} label="Observações">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Informe pendências, combinado com o entregador ou detalhes para o acerto final…"
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
            </CadastroField>

            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              Ao aprovar, o Operacional inativa o entregador e o sistema encerra automaticamente os vínculos ativos com farmácias e líder.
            </div>

            {message ? (
              <div
                className={cn(
                  'rounded-lg border px-3 py-2 text-sm',
                  message.startsWith('Solicitação') ? 'border-success/30 bg-success/10 text-success' : 'border-destructive/30 bg-destructive/10 text-destructive'
                )}
              >
                {message}
              </div>
            ) : null}

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => {
                if (!selectedDriver) return;
                void createMutation.mutateAsync({
                  driver_id: selectedDriver.id,
                  last_worked_at: lastWorkedAt,
                  reason,
                  notes: notes.trim() ? notes.trim() : null,
                });
              }}
              className={cn(
                'inline-flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-glow',
                !canSubmit && 'pointer-events-none opacity-50'
              )}
            >
              {createMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar solicitação de desligamento
            </button>
          </CadastroSection>
        </div>

        <aside className="self-start overflow-hidden rounded-xl border border-border bg-surface">
          <div className="border-b border-border px-4 py-3">
            <h4 className="text-sm font-semibold">Solicitações recentes</h4>
            <p className="text-[11px] text-muted-foreground">Demandas enviadas para Operacional e Financeiro.</p>
          </div>
          <div className="p-4">
            {requestsQuery.isLoading ? (
              <div className="text-xs text-muted-foreground">Carregando…</div>
            ) : (requestsQuery.data || []).length === 0 ? (
              <div className="text-xs text-muted-foreground">Nenhuma solicitação recente.</div>
            ) : (
              <div className="space-y-2">
                {(requestsQuery.data || []).slice(0, 12).map((task) => (
                  <div key={task.id} className="rounded-lg border border-border bg-background/40 px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium">{task.driver?.name || task.title}</div>
                        <div className="mt-0.5 text-[10px] text-muted-foreground">
                          {task.task_type === 'driver_termination_financial_review' ? 'Financeiro' : 'Operacional'}
                        </div>
                      </div>
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-1.5 py-0.5 text-[10px]',
                          task.status === 'done'
                            ? 'border-success/30 bg-success/10 text-success'
                            : task.status === 'cancelled'
                              ? 'border-destructive/30 bg-destructive/10 text-destructive'
                              : 'border-warning/30 bg-warning/10 text-warning'
                        )}
                      >
                        {statusLabel(task.status)}
                      </span>
                    </div>
                    {task.status === 'done' ? (
                      <div className="mt-2 flex items-center gap-1 text-[10px] text-success">
                        <CheckCircle2 className="h-3 w-3" />
                        Desligamento operacional aplicado
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </aside>
      </div>
    </CadastroPageScroll>
  );
}

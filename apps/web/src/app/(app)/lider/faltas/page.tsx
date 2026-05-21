'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Send, UserX } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';

type Driver = {
  id: string;
  name: string;
  primary_pharmacy_id: string | null;
  primary_pharmacy?: { trade_name: string } | null;
  leader_linked_pharmacy_ids?: string[];
};
type Pharmacy = { id: string; trade_name: string };

export default function LiderFaltasPage() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();
  const [driverId, setDriverId] = useState<string>('');
  const [pharmacyIds, setPharmacyIds] = useState<string[]>([]);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState<string>('');

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

  const selectedDriver = useMemo(() => (driversQuery.data || []).find((d) => d.id === driverId) || null, [driversQuery.data, driverId]);

  const driverPharmacies = useMemo(() => {
    const all = pharmaciesQuery.data || [];
    const ids = new Set((selectedDriver?.leader_linked_pharmacy_ids || []).filter(Boolean));
    if (!ids.size) return [];
    return all.filter((p) => ids.has(p.id));
  }, [pharmaciesQuery.data, selectedDriver?.leader_linked_pharmacy_ids]);

  useEffect(() => {
    if (!selectedDriver) {
      setPharmacyIds([]);
      return;
    }
    const preferred = (selectedDriver.leader_linked_pharmacy_ids || []).filter(Boolean);
    if (preferred.length) {
      setPharmacyIds(preferred);
      return;
    }
    if (selectedDriver.primary_pharmacy_id) {
      setPharmacyIds([selectedDriver.primary_pharmacy_id]);
      return;
    }
    setPharmacyIds([]);
  }, [selectedDriver?.id]);

  const createMutation = useMutation({
    mutationFn: async (payload: { driver_id: string; pharmacy_ids: string[]; date: string; reason?: string }) =>
      (await api.post('/api/leader-portal/absences', payload)).data,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['leader-portal', 'stats'] });
    },
  });

  const submit = async () => {
    if (!selectedDriver) return;
    const ids = pharmacyIds.filter(Boolean);
    if (!ids.length) return;
    await createMutation.mutateAsync({ driver_id: selectedDriver.id, pharmacy_ids: ids, date, reason: reason || undefined });
    setReason('');
  };

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Lançamento de faltas" description="Esta área é exclusiva para perfis de líder." compact />
        <Link className="button-secondary" href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl">
      <PageHeader
        eyebrow="Operação"
        title="Lançamento de faltas"
        description="Registre ausências da sua equipe e anexe documentos quando houver."
      />

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <UserX className="h-4 w-4 text-destructive" />
            <h3 className="text-sm font-semibold">Nova falta</h3>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground">Entregador</label>
              <select
                value={driverId}
                onChange={(e) => setDriverId(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
              >
                <option value="">Selecione…</option>
                {(driversQuery.data || []).map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Farmácias (vínculo)</label>
              {selectedDriver ? (
                driverPharmacies.length ? (
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
                              setPharmacyIds((curr) => (on ? Array.from(new Set([...curr, p.id])) : curr.filter((x) => x !== p.id)));
                            }}
                          />
                          <span className="truncate">{p.trade_name}</span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <div className="mt-2 rounded-md border border-border bg-background/40 p-3 text-xs text-muted-foreground">
                    Nenhuma farmácia vinculada encontrada para este entregador.
                  </div>
                )
              ) : (
                <div className="mt-2 text-xs text-muted-foreground">Selecione um entregador para listar as farmácias.</div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-muted-foreground">Data</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Turno</label>
                <select className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm">
                  <option>Dia inteiro</option>
                  <option>Manhã</option>
                  <option>Tarde</option>
                  <option>Noite</option>
                </select>
              </div>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">Motivo / observações</label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={4}
                placeholder="Descreva o ocorrido..."
                className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Faltas são registradas como <b className="text-warning">pendente de aprovação</b>.
            </div>

            <button
              type="button"
              disabled={!driverId || pharmacyIds.length === 0 || createMutation.isPending}
              onClick={() => void submit()}
              className={cn(
                'w-full rounded-lg bg-destructive py-2.5 text-sm font-medium text-destructive-foreground hover:bg-destructive/90 flex items-center justify-center gap-2',
                (!driverId || pharmacyIds.length === 0 || createMutation.isPending) && 'opacity-50 pointer-events-none'
              )}
            >
              <Send className="h-4 w-4" /> Registrar falta
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h3 className="text-sm font-semibold">Resumo</h3>
            <p className="text-[11px] text-muted-foreground">Acompanhe pendências no dashboard.</p>
          </div>
          <div className="p-5 text-sm text-muted-foreground">
            A farmácia usada no lançamento é a <b className="text-foreground">primária</b> do entregador (ou a primeira da sua rede, se não houver).
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CalendarCheck, Clock, DollarSign, Send } from 'lucide-react';
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

export default function LiderDiariasPage() {
  const user = useAuth((s) => s.user);
  const qc = useQueryClient();

  const [driverId, setDriverId] = useState<string>('');
  const [pharmacyIds, setPharmacyIds] = useState<string[]>([]);
  const [date, setDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState<number>(150);
  const [description, setDescription] = useState<string>('Lançamento de diária');
  const [notes, setNotes] = useState<string>('');

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

  const selectedDriver = useMemo(
    () => (driversQuery.data || []).find((d) => d.id === driverId) || null,
    [driversQuery.data, driverId]
  );

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

  const total = useMemo(() => (Number.isFinite(amount) ? amount : 0), [amount]);

  const createMutation = useMutation({
    mutationFn: async (payload: {
      driver_id: string;
      pharmacy_ids: string[];
      amount: number;
      date?: string;
      description?: string;
      notes?: string;
    }) => (await api.post('/api/leader-portal/dailies', payload)).data,
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['leader-portal', 'stats'] });
    },
  });

  const canSubmit = Boolean(driverId) && pharmacyIds.length > 0 && amount > 0 && !createMutation.isPending;

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Lançamento de diárias" description="Esta área é exclusiva para perfis de líder." compact />
        <Link className="button-secondary" href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-7xl">
      <PageHeader eyebrow="Operação" title="Lançamento de diárias" description="Selecione o entregador, as farmácias atendidas e confirme." />

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-xl border border-border bg-card p-6">
          <div className="flex items-center gap-2 mb-4">
            <CalendarCheck className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold">Nova diária</h3>
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
              <label className="text-xs text-muted-foreground">Farmácias (diária)</label>
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
                <label className="text-xs text-muted-foreground">Valor</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(Number(e.target.value))}
                  className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Descrição</label>
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
              />
            </div>

            <div>
              <label className="text-xs text-muted-foreground">Motivo / observações</label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={4}
                placeholder="Detalhes da diária…"
                className="mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm"
              />
            </div>

            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/5 p-3 text-xs text-warning">
              <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
              Diárias são registradas como <b className="text-warning">pendente de aprovação</b>.
            </div>

            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => {
                if (!selectedDriver) return;
                const ids = pharmacyIds.filter(Boolean);
                void createMutation
                  .mutateAsync({
                    driver_id: selectedDriver.id,
                    pharmacy_ids: ids,
                    amount,
                    date: date || undefined,
                    description: description || undefined,
                    notes: notes || undefined,
                  })
                  .then(() => setNotes(''));
              }}
              className={cn(
                'w-full rounded-lg bg-primary py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary-glow flex items-center justify-center gap-2',
                !canSubmit && 'opacity-50 pointer-events-none'
              )}
            >
              <Send className="h-4 w-4" /> Registrar diária
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card overflow-hidden">
          <div className="border-b border-border px-5 py-4">
            <h3 className="text-sm font-semibold">Resumo</h3>
            <p className="text-[11px] text-muted-foreground">Confira antes de lançar.</p>
          </div>
          <div className="p-5">
            <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <CalendarCheck className="h-3 w-3" /> Detalhes
            </h4>
            <Row label="Entregador" value={selectedDriver?.name || '—'} />
            <Row label="Data" value={date || '—'} />
            <Row label="Farmácias" value={pharmacyIds.length ? `${pharmacyIds.length} selecionada(s)` : '—'} />
            <div className="mt-3 border-t border-border pt-3">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" /> Total
                </span>
                <span className="text-lg font-semibold text-success">R$ {total},00</span>
              </div>
            </div>
          </div>
          <div className="border-t border-border p-5 text-xs text-muted-foreground flex items-start gap-2">
            <Clock className="h-3.5 w-3.5 mt-0.5 text-primary" />
            Use a seleção de farmácias para refletir onde a diária ocorreu.
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}


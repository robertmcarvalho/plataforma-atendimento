'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import api from '@/lib/api';
import { onApiError } from '@/lib/apiErrorMessage';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { SectionTitle } from '@/components/ui/SectionTitle';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { AdvanceInstallmentPreview } from '@/components/financial/AdvanceInstallmentPreview';
import { buildAdvanceInstallmentPreview } from '@/lib/financial/installmentPreview';
import type { DiscountRule } from '@/lib/financialCycle';

export type AdvanceEntryPrefill = {
  driver_id: string;
  driver_name: string;
  pharmacies: Array<{ id: string; trade_name: string }>;
  default_pharmacy_id: string;
  start_date: string;
  type: 'advance';
  frequency: string;
  suggested_amount?: number;
};

type Props = {
  open: boolean;
  taskId: string;
  prefill: AdvanceEntryPrefill;
  defaultAmount?: number;
  onClose: () => void;
  onDone: () => void;
};

function formatBrl(n: number) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);
}

export function InboxAdvanceEntryDrawer({ open, taskId, prefill, defaultAmount, onClose, onDone }: Props) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    pharmacy_id: prefill.default_pharmacy_id || prefill.pharmacies[0]?.id || '',
    driver_id: prefill.driver_id,
    type: 'advance',
    total_amount: defaultAmount ? String(defaultAmount) : prefill.suggested_amount ? String(prefill.suggested_amount) : '',
    installments_count: '1',
    frequency: prefill.frequency || 'weekly',
    start_date: prefill.start_date,
    description: 'Adiantamento aprovado — portal do líder',
    notes: '',
  }));

  const installmentValue = useMemo(() => {
    const total = parseFloat(form.total_amount) || 0;
    const count = parseInt(form.installments_count, 10) || 1;
    return total / count;
  }, [form.total_amount, form.installments_count]);

  const { data: discountRulesPayload } = useQuery({
    queryKey: ['financial-discount-rules'],
    queryFn: () => api.get('/api/financial/discount-rules').then((r) => r.data as { rules: Record<string, DiscountRule> }),
  });

  const installmentPreview = useMemo(
    () =>
      buildAdvanceInstallmentPreview({
        cycleBaseDate: form.start_date,
        installmentsCount: parseInt(form.installments_count, 10) || 1,
        totalAmount: parseFloat(form.total_amount) || 0,
        discountRules: discountRulesPayload?.rules,
      }),
    [discountRulesPayload?.rules, form.installments_count, form.start_date, form.total_amount]
  );

  const mut = useMutation({
    mutationFn: async () => {
      await api.post(
        '/api/financial/entries',
        {
          pharmacy_id: form.pharmacy_id || undefined,
          driver_id: form.driver_id,
          type: 'advance',
          total_amount: parseFloat(form.total_amount),
          installments_count: parseInt(form.installments_count, 10) || 1,
          frequency: form.frequency,
          start_date: form.start_date,
          description: form.description.trim() || undefined,
          notes: form.notes.trim() || undefined,
        },
        { headers: { 'x-from-task': taskId } }
      );
      await api.patch(`/api/tasks/${taskId}`, { status: 'done' });
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['inbox'] });
      onDone();
      onClose();
    },
    onError: onApiError(setError, 'Falha ao lançar adiantamento.'),
  });

  if (!open) return null;

  const pharmacyName =
    prefill.pharmacies.find((p) => p.id === form.pharmacy_id)?.trade_name ||
    prefill.pharmacies[0]?.trade_name ||
    '—';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <Card className="max-h-[90vh] w-full max-w-lg gap-0 overflow-y-auto py-6 shadow-md ring-0">
        <CardContent className="px-6 pt-0">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Lançamento de adiantamento</h3>
            <p className="text-xs text-muted-foreground">Confira os dados pré-preenchidos e finalize o lançamento.</p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} className="text-muted-foreground">
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="mb-4 space-y-2 rounded-lg border border-primary/20 bg-primary/10 p-3 text-xs">
          <p>
            <span className="font-semibold text-foreground">Entregador: </span>
            {prefill.driver_name || '—'}
          </p>
          <p>
            <span className="font-semibold text-foreground">Farmácia: </span>
            {pharmacyName}
          </p>
          <p>
            <span className="font-semibold text-foreground">Data do lançamento: </span>
            {format(new Date(form.start_date + 'T12:00:00'), 'dd/MM/yyyy')}
          </p>
        </div>

        <div className="space-y-4">
          {prefill.pharmacies.length > 1 ? (
            <div className="space-y-1.5">
              <SectionTitle>Farmácia</SectionTitle>
              <FormSearchCombobox
                value={form.pharmacy_id}
                onChange={(v) => setForm((f) => ({ ...f, pharmacy_id: v }))}
                placeholder="Buscar farmácia…"
                options={prefill.pharmacies.map((p) => ({ value: p.id, label: p.trade_name }))}
              />
            </div>
          ) : null}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <SectionTitle>Valor total (R$)</SectionTitle>
              <FormControl
                type="number"
                value={form.total_amount}
                onChange={(e) => setForm((f) => ({ ...f, total_amount: e.target.value }))}
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <SectionTitle>Nº parcelas</SectionTitle>
              <FormControl
                type="number"
                min={1}
                value={form.installments_count}
                onChange={(e) => setForm((f) => ({ ...f, installments_count: e.target.value }))}
                className="font-mono"
              />
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center text-xs">
            <span className="font-semibold text-primary">Parcela estimada: </span>
            <span className="font-mono font-bold text-primary">{formatBrl(installmentValue)}</span>
          </div>

          <div className="space-y-1.5">
            <SectionTitle>Data base do ciclo</SectionTitle>
            <FormControl
              type="date"
              value={form.start_date}
              onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))}
            />
            <p className="text-[10px] text-muted-foreground">
              A 1ª quinta de desconto será calculada a partir desta data.
            </p>
          </div>

          <AdvanceInstallmentPreview
            preview={installmentPreview}
            totalCount={parseInt(form.installments_count, 10) || 1}
          />

          <div className="space-y-1.5">
            <SectionTitle>Descrição / justificativa</SectionTitle>
            <textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              rows={2}
              className={formTextareaClassName}
            />
          </div>

          <div className="space-y-1.5">
            <SectionTitle>Observações internas</SectionTitle>
            <textarea
              value={form.notes}
              onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
              rows={2}
              className={formTextareaClassName}
            />
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <div className="flex gap-3 pt-2">
            <Button type="button" onClick={onClose} variant="secondary" className="flex-1 text-sm">
              Cancelar
            </Button>
            <Button
              type="button"
              disabled={mut.isPending || !form.pharmacy_id || !form.driver_id || !form.total_amount}
              onClick={() => mut.mutate()}
              className="flex-1 text-sm"
            >
              {mut.isPending ? 'Salvando…' : 'Confirmar lançamento'}
            </Button>
          </div>
        </div>
        </CardContent>
      </Card>
    </div>
  );
}

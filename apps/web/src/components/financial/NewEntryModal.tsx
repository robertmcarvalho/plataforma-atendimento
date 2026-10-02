'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { X } from 'lucide-react';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { CadastroSearchCombobox } from '@/components/cadastro/CadastroSearchCombobox';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { AdvanceInstallmentPreview } from '@/components/financial/AdvanceInstallmentPreview';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { formatBRL } from '@/lib/brFormat';
import { formatDateBr } from '@/lib/datetimeBr';
import { buildInstallmentPreview } from '@/lib/financial/installmentPreview';
import { useTypeLabels } from '@/lib/financial/entryTypesContext';
import type { DriverOption, PharmacyOption } from '@/lib/financial/types';
import type { DiscountRule } from '@/lib/financialCycle';

export function NewEntryModal({ 
  onClose, 
  onCreated,
  approvalMode,
}: { 
  onClose: () => void; 
  onCreated: () => void;
  approvalMode?: {
    enabled: boolean;
    taskId: string;
    driverId: string;
    startDate: string;
  };
}) {
  const labels = useTypeLabels();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    pharmacy_id: '',
    driver_id: approvalMode?.enabled ? approvalMode.driverId : '',
    type: approvalMode?.enabled ? 'advance' : 'quota',
    total_amount: '',
    installments_count: '1',
    frequency: 'weekly',
    start_date: approvalMode?.enabled ? approvalMode.startDate : format(new Date(), 'yyyy-MM-dd'),
    description: '',
    notes: '',
  });

  const { data: pharmacies, isLoading: loadingPharmacies } = useQuery<PharmacyOption[]>({
    queryKey: ['pharmacies-active-financial'],
    queryFn: () => api.get('/api/pharmacies', { params: { status: 'active' } }).then((r) => r.data),
  });

  const { data: allDrivers, isLoading: loadingDrivers, error: driversError } = useQuery<DriverOption[]>({
    queryKey: ['drivers-active-list'],
    queryFn: () => api.get('/api/drivers', { params: { status: 'active' } }).then((r) => r.data),
  });

  const driversForPharmacy = useMemo(() => {
    if (!form.pharmacy_id) return [];
    return (allDrivers || []).filter(
      (d) =>
        d.primary_pharmacy_id === form.pharmacy_id ||
        (d.driver_pharmacy_links || []).some(
          (l) => l.is_active !== false && l.pharmacies?.id === form.pharmacy_id
        )
    );
  }, [allDrivers, form.pharmacy_id]);

  const selectedPharmacy = useMemo(
    () => (pharmacies || []).find((p) => p.id === form.pharmacy_id),
    [pharmacies, form.pharmacy_id]
  );

  if (driversError) {
    console.error('Falha ao carregar entregadores:', driversError);
  }

  const installmentValue = useMemo(() => {
    const total = parseFloat(form.total_amount) || 0;
    const count = parseInt(form.installments_count) || 1;
    return total / count;
  }, [form.total_amount, form.installments_count]);

  const { data: discountRulesPayload } = useQuery({
    queryKey: ['financial-discount-rules'],
    queryFn: () => api.get('/api/financial/discount-rules').then((r) => r.data as { rules: Record<string, DiscountRule> }),
  });

  const installmentPreview = useMemo(
    () =>
      buildInstallmentPreview({
        entryType: form.type,
        cycleBaseDate: form.start_date || format(new Date(), 'yyyy-MM-dd'),
        installmentsCount: parseInt(form.installments_count) || 1,
        totalAmount: parseFloat(form.total_amount) || 0,
        frequency: form.frequency,
        discountRules: discountRulesPayload?.rules,
      }),
    [
      discountRulesPayload?.rules,
      form.frequency,
      form.installments_count,
      form.start_date,
      form.total_amount,
      form.type,
    ]
  );

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/financial/entries', {
        ...form,
        pharmacy_id: form.pharmacy_id || undefined,
        total_amount: parseFloat(form.total_amount),
        installments_count: parseInt(form.installments_count),
        notes: form.notes || undefined,
      }, {
        headers: approvalMode?.enabled ? { 'x-from-task': approvalMode.taskId } : undefined,
      });
      onCreated();
      onClose();
    } catch (e: unknown) {
      setError(apiErrorMessage(e, 'Erro ao criar lançamento'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-md animate-in fade-in zoom-in duration-200">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Novo lançamento</h3>
            <p className="text-xs text-muted-foreground">Configure as cotas ou descontos do entregador.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {approvalMode?.enabled ? (
            <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 text-xs text-primary">
              Modo aprovação de adiantamento: ajuste valor, parcelas, data base do ciclo e descrição antes de confirmar.
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Farmácia</label>
            <CadastroSearchCombobox
              entity="pharmacy"
              value={form.pharmacy_id}
              onChange={(v) =>
                setForm((f) => ({ ...f, pharmacy_id: v, driver_id: approvalMode?.enabled ? f.driver_id : '' }))
              }
              disabled={approvalMode?.enabled || loadingPharmacies}
              className="mt-0"
            />
          </div>

          {selectedPharmacy ? (
            <div className="rounded-lg border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Líder da rede: </span>
              {selectedPharmacy.leader?.name || '—'}
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Entregador</label>
            <FormSearchCombobox
              value={form.driver_id}
              onChange={(v) => setForm((f) => ({ ...f, driver_id: v }))}
              disabled={approvalMode?.enabled || !form.pharmacy_id || loadingDrivers}
              placeholder={
                !form.pharmacy_id ? 'Selecione a farmácia primeiro' : 'Buscar entregador…'
              }
              options={driversForPharmacy.map((d) => ({ value: d.id, label: `${d.name} (${d.cpf})` }))}
            />
            {form.pharmacy_id && !loadingDrivers && driversForPharmacy.length === 0 ? (
              <p className="text-[10px] text-warning">Nenhum entregador ativo vinculado a esta farmácia.</p>
            ) : null}
            {driversError && <p className="text-[10px] text-destructive">Erro ao carregar lista de entregadores.</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Tipo</label>
              <FormSelect
                value={form.type}
                onChange={(v) => setForm((f) => ({ ...f, type: v }))}
                disabled={approvalMode?.enabled}
                options={Object.entries(labels)
                  .filter(([val]) => !['daily', 'absence'].includes(val))
                  .map(([val, label]) => ({ value: val, label }))}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Frequência</label>
              <FormSelect
                value={form.frequency}
                onChange={(v) => setForm((f) => ({ ...f, frequency: v }))}
                disabled={approvalMode?.enabled}
                options={[
                  { value: 'weekly', label: 'Semanal (Pagamento Quinta)' },
                  { value: 'monthly', label: 'Mensal' },
                ]}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Valor Total</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">R$</span>
                <FormControl
                  type="number"
                  value={form.total_amount}
                  onChange={(e) => setForm(f => ({ ...f, total_amount: e.target.value }))}
                  placeholder="0,00"
                  className="pl-9 font-mono transition-colors"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Nº Parcelas</label>
              <FormControl
                type="number"
                min={1}
                value={form.installments_count}
                onChange={(e) => setForm(f => ({ ...f, installments_count: e.target.value }))}
                className="font-mono transition-colors"
              />
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Valor da parcela estimada</span>
            <div className="text-xl font-bold text-primary">{formatBRL(installmentValue)}</div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Data Base do Ciclo</label>
            <FormControl
              type="date"
              lang="pt-BR"
              value={form.start_date}
              onChange={(e) => setForm(f => ({ ...f, start_date: e.target.value }))}
              className="transition-colors"
            />
            <div className="text-xs text-muted-foreground">{formatDateBr(form.start_date)}</div>
          </div>

          <AdvanceInstallmentPreview
            preview={installmentPreview}
            totalCount={parseInt(form.installments_count) || 1}
            showFirstThursday={form.type === 'advance'}
          />

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Motivo / observações</label>
            <textarea
              value={form.notes}
              onChange={(e) => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              placeholder="Ex: Falta justificada, diária extra..."
              className={formTextareaClassName}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={onClose}>
              Cancelar
            </Button>
            <Button
              className="flex-1 shadow-md"
              onClick={handleSave}
              disabled={saving || !form.pharmacy_id || !form.driver_id || !form.total_amount}
            >
              {saving ? 'Criando...' : 'Confirmar Lançamento'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
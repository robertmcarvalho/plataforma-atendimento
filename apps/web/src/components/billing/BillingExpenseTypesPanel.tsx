'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Plus, Pencil, Tags } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import {
  BillingActionFeedbackDialog,
  BillingDialogContent,
  BillingEmptyState,
  BillingField,
  BillingSection,
  BillingSwitchRow,
  billingDialogGridClassName,
} from '@/components/billing/BillingPrimitives';
import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  fetchCostCenters,
  fetchExpenseTypes,
  seedDefaultExpenseTypes,
  saveExpenseType,
  type BillingExpenseType,
} from '@/lib/billing/billingApi';
import { billingSegmentButton, billingSegmentShellClassName } from '@/lib/billing/billingReviveUi';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';

type EditState = Partial<BillingExpenseType> & Pick<BillingExpenseType, 'name' | 'kind'>;

const empty: EditState = {
  name: '',
  kind: 'variable',
  default_entity: 'both',
  allocation_mode: 'none',
  active: true,
  default_cost_center_id: null,
  recurrence: null,
  affects_dre: true,
  management_group: 'administrative',
  dre_group: 'administrative_expense',
  allocation_policy: 'revenue_share',
  requires_cost_center: false,
};

const ALLOCATION_LABELS: Record<string, string> = {
  none: 'Sem rateio',
  per_pharmacy: 'Por farmácia',
  per_driver: 'Por entregador',
  per_delivery: 'Por entrega',
  per_provider: 'Por prestador',
};

const MANAGEMENT_GROUP_LABELS: Record<string, string> = {
  operational: 'Operacional',
  administrative: 'Administrativo',
  financial: 'Financeiro',
  tax: 'Tributário',
  commercial: 'Comercial',
  patrimonial: 'Patrimonial',
  outside_dre: 'Fora DRE',
};

const DRE_GROUP_LABELS: Record<string, string> = {
  revenue: 'Receita',
  operational_cost: 'Custo operacional',
  administrative_expense: 'Despesa adm.',
  commercial_expense: 'Despesa comercial',
  financial_expense: 'Despesa financeira',
  tax: 'Impostos',
  outside_dre: 'Fora DRE',
};

const ALLOCATION_POLICY_LABELS: Record<string, string> = {
  direct_cost_center: 'Centro direto',
  revenue_share: 'Rateio por receita',
  driver_share: 'Por entregador',
  delivery_share: 'Por entrega',
  manual: 'Manual',
  none: 'Não aloca',
};

export function BillingExpenseTypesPanel() {
  const qc = useQueryClient();
  const [filtro, setFiltro] = useState<'todas' | 'fixed' | 'variable'>('todas');
  const [edit, setEdit] = useState<EditState | null>(null);
  const [feedback, setFeedback] = useState<{ title: string; description?: string; items?: string[] } | null>(null);

  const typesQuery = useQuery({ queryKey: ['billing', 'expense-types'], queryFn: fetchExpenseTypes });
  const ccQuery = useQuery({ queryKey: ['billing', 'cost-centers', 'active'], queryFn: () => fetchCostCenters(true) });

  const saveMut = useMutation({
    mutationFn: (row: EditState) => saveExpenseType(row),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'expense-types'] });
      setEdit(null);
    },
  });
  const seedMut = useMutation({
    mutationFn: seedDefaultExpenseTypes,
    onSuccess: async (res) => {
      await qc.invalidateQueries({ queryKey: ['billing', 'expense-types'] });
      setFeedback({
        title: 'Categorias padrão sincronizadas',
        description: 'Seed idempotente executado para o workspace atual.',
        items: [`Criadas: ${res.created}`, `Atualizadas ou já existentes: ${res.skipped}`],
      });
    },
  });

  const lista = (typesQuery.data || []).filter((t) => filtro === 'todas' || t.kind === filtro);

  return (
    <BillingSection
      title="Tipos de despesa"
      desc="Classifique despesas fixas e variáveis, alocação padrão e recorrência."
      icon={Tags}
      action={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => seedMut.mutate()} disabled={seedMut.isPending}>
            Semear padrão
          </Button>
          <Button size="sm" onClick={() => setEdit({ ...empty })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Novo tipo
          </Button>
        </div>
      }
    >
      <div className="flex items-center justify-between">
        <div className={billingSegmentShellClassName}>
          {(['todas', 'fixed', 'variable'] as const).map((f) => (
            <button key={f} type="button" onClick={() => setFiltro(f)} className={billingSegmentButton(filtro === f)}>
              {f === 'todas' ? 'todas' : f === 'fixed' ? 'fixa' : 'variavel'}
            </button>
          ))}
        </div>
      </div>

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Classif.</th>
              <th className="px-4 py-3">Entidade default</th>
              <th className="px-4 py-3">Natureza</th>
              <th className="px-4 py-3">Grupo DRE</th>
              <th className="px-4 py-3">Regra</th>
              <th className="px-4 py-3">DRE</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {lista.map((t) => (
              <tr key={t.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{t.name}</td>
                <td className="px-4 py-2.5 text-xs capitalize">{t.kind === 'fixed' ? 'fixa' : 'variável'}</td>
                <td className="px-4 py-2.5 text-xs capitalize">{t.default_entity}</td>
                <td className="px-4 py-2.5 text-xs">{MANAGEMENT_GROUP_LABELS[t.management_group] || t.management_group}</td>
                <td className="px-4 py-2.5 text-xs">{DRE_GROUP_LABELS[t.dre_group] || t.dre_group}</td>
                <td className="px-4 py-2.5 text-xs">{ALLOCATION_POLICY_LABELS[t.allocation_policy] || ALLOCATION_LABELS[t.allocation_mode] || t.allocation_mode}</td>
                <td className="px-4 py-2.5 text-xs">
                  {t.affects_dre === false ? 'Não afeta' : t.requires_cost_center && !t.default_cost_center_id ? 'Falta CC' : 'Afeta'}
                </td>
                <td className="px-4 py-2.5">
                  <span
                    className={cn(
                      'inline-flex rounded px-2 py-0.5 text-[10px] font-medium',
                      t.active ? 'bg-success/15 text-success' : 'bg-muted text-muted-foreground'
                    )}
                  >
                    {t.active ? 'Ativo' : 'Inativo'}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button type="button" onClick={() => setEdit({ ...t })} className="text-xs text-primary hover:underline">
                    <Pencil className="mr-1 inline h-3 w-3" /> Editar
                  </button>
                </td>
              </tr>
            ))}
            {!lista.length && !typesQuery.isLoading ? (
              <tr>
                <td colSpan={8} className="p-4">
                  <BillingEmptyState>Nenhum tipo de despesa cadastrado.</BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {edit && (
        <Dialog open onOpenChange={(v) => !v && setEdit(null)}>
          <BillingDialogContent
            title={`${edit.id ? 'Editar' : 'Novo'} tipo de despesa`}
            description="Configure classificação, alocação, recorrência e centro de custo padrão."
            footer={
              <>
                <Button variant="outline" className="flex-1" onClick={() => setEdit(null)}>
                  Cancelar
                </Button>
                <Button className="flex-1 shadow-md" disabled={!edit.name.trim() || saveMut.isPending} onClick={() => saveMut.mutate(edit)}>
                  Salvar
                </Button>
              </>
            }
          >
            <div className={billingDialogGridClassName}>
              <BillingField label="Nome" className="col-span-2">
                <FormControl className="text-xs" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </BillingField>
              <BillingField label="Classificação">
                <FormSelect
                  className="mt-1 w-full"
                  value={edit.kind}
                  onChange={(value) => setEdit({ ...edit, kind: value as 'fixed' | 'variable' })}
                  options={[
                    { value: 'fixed', label: 'Fixa' },
                    { value: 'variable', label: 'Variável' },
                  ]}
                />
              </BillingField>
              <BillingField label="Entidade default">
                <FormSelect
                  className="mt-1 w-full"
                  value={edit.default_entity || 'both'}
                  onChange={(value) => setEdit({ ...edit, default_entity: value as BillingExpenseType['default_entity'] })}
                  options={[
                    { value: 'coop', label: 'Cooperativa' },
                    { value: 'flux', label: 'Flux Farma' },
                    { value: 'both', label: 'Ambas (a definir)' },
                  ]}
                />
              </BillingField>
              <BillingField label="Modo alocação">
                <FormSelect
                  className="mt-1 w-full"
                  value={edit.allocation_mode || 'none'}
                  onChange={(value) => setEdit({ ...edit, allocation_mode: value as BillingExpenseType['allocation_mode'] })}
                  options={[
                    { value: 'none', label: 'Sem rateio' },
                    { value: 'per_pharmacy', label: 'Por farmácia' },
                    { value: 'per_driver', label: 'Por entregador' },
                    { value: 'per_delivery', label: 'Por entrega' },
                    { value: 'per_provider', label: 'Por prestador' },
                  ]}
                />
              </BillingField>
              <BillingField label="Recorrência">
                <FormSelect
                  className="mt-1 w-full"
                  value={edit.recurrence || 'none'}
                  onChange={(value) => setEdit({ ...edit, recurrence: value === 'none' ? null : value })}
                  options={[
                    { value: 'none', label: '— Nenhuma —' },
                    { value: 'weekly', label: 'Semanal' },
                    { value: 'monthly', label: 'Mensal' },
                    { value: 'yearly', label: 'Anual' },
                  ]}
                />
              </BillingField>
              <BillingField label="Natureza gerencial">
                <FormSelect
                  className="mt-1 w-full"
                  value={edit.management_group || 'administrative'}
                  onChange={(value) => setEdit({ ...edit, management_group: value as BillingExpenseType['management_group'] })}
                  options={[
                    { value: 'operational', label: 'Operacional' },
                    { value: 'administrative', label: 'Administrativo' },
                    { value: 'commercial', label: 'Comercial' },
                    { value: 'financial', label: 'Financeiro' },
                    { value: 'tax', label: 'Tributário' },
                    { value: 'patrimonial', label: 'Patrimonial' },
                    { value: 'outside_dre', label: 'Fora DRE' },
                  ]}
                />
              </BillingField>
              <BillingField label="Grupo DRE">
                <FormSelect
                  className="mt-1 w-full"
                  value={edit.dre_group || 'administrative_expense'}
                  onChange={(value) => setEdit({ ...edit, dre_group: value as BillingExpenseType['dre_group'] })}
                  options={[
                    { value: 'operational_cost', label: 'Custo operacional' },
                    { value: 'administrative_expense', label: 'Despesa administrativa' },
                    { value: 'commercial_expense', label: 'Despesa comercial' },
                    { value: 'financial_expense', label: 'Despesa financeira' },
                    { value: 'tax', label: 'Imposto / taxa' },
                    { value: 'outside_dre', label: 'Fora DRE' },
                  ]}
                />
              </BillingField>
              <BillingField label="Regra de alocação">
                <FormSelect
                  className="mt-1 w-full"
                  value={edit.allocation_policy || 'revenue_share'}
                  onChange={(value) => setEdit({ ...edit, allocation_policy: value as BillingExpenseType['allocation_policy'] })}
                  options={[
                    { value: 'direct_cost_center', label: 'Centro de custo direto' },
                    { value: 'revenue_share', label: 'Rateio por receita' },
                    { value: 'driver_share', label: 'Rateio por entregador' },
                    { value: 'delivery_share', label: 'Rateio por entrega' },
                    { value: 'manual', label: 'Manual' },
                    { value: 'none', label: 'Não aloca' },
                  ]}
                />
              </BillingField>
              <BillingField label="Centro de custo padrão (opcional)" className="col-span-2">
                <FormSelect
                  className="mt-1 w-full"
                  value={edit.default_cost_center_id || 'none'}
                  onChange={(value) => setEdit({ ...edit, default_cost_center_id: value === 'none' ? null : value })}
                  options={[
                    { value: 'none', label: '— Nenhum —' },
                    ...(ccQuery.data || []).map((c) => ({ value: c.id, label: c.name })),
                  ]}
                />
              </BillingField>
              <div className="col-span-2">
                <BillingSwitchRow
                  checked={edit.active !== false}
                  onChange={(checked) => setEdit({ ...edit, active: checked })}
                  label="Tipo ativo"
                />
              </div>
              <div className="col-span-2">
                <BillingSwitchRow
                  checked={edit.requires_cost_center === true}
                  onChange={(checked) => setEdit({ ...edit, requires_cost_center: checked })}
                  label="Exige centro de custo"
                  description="Use para despesas que não devem entrar no DRE sem classificação direta."
                />
              </div>
              <div className="col-span-2">
                <BillingSwitchRow
                  checked={edit.affects_dre !== false}
                  onChange={(checked) => setEdit({ ...edit, affects_dre: checked })}
                  label="Afeta DRE"
                  description="Desative para transferências, adiantamentos ou movimentos patrimoniais."
                />
              </div>
              {edit.affects_dre !== false && edit.requires_cost_center && !edit.default_cost_center_id ? (
                <div className="col-span-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                  Esta categoria afeta DRE e exige centro de custo. Lançamentos sem centro de custo aparecerão como pendência gerencial.
                </div>
              ) : null}
            </div>
          </BillingDialogContent>
        </Dialog>
      )}
      <Dialog open={!!feedback} onOpenChange={(open) => !open && setFeedback(null)}>
        {feedback ? (
          <BillingActionFeedbackDialog
            open={!!feedback}
            onOpenChange={(open) => !open && setFeedback(null)}
            title={feedback.title}
            description={feedback.description}
            items={feedback.items}
          />
        ) : null}
      </Dialog>
    </BillingSection>
  );
}

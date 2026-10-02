'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building2, CalendarDays, Plus, Pencil, Route, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { BrCentsInput } from '@/components/form/BrCentsInput';
import {
  BillingDialogContent,
  BillingEmptyState,
  BillingField,
  BillingSection,
  BillingSwitchRow,
  billingPageStackClassName,
} from '@/components/billing/BillingPrimitives';
import { cadastroPageApi } from '@/lib/cadastro/cadastroPageApi';
import { pharmacyDisplayName } from '@/lib/billing/billingDisplay';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import {
  deleteCostCenter,
  deleteDailyShareGroup,
  deleteBillingHoliday,
  fetchCostCenters,
  fetchDailyShareGroups,
  fetchBillingHolidays,
  saveCostCenter,
  saveDailyShareGroup,
  saveBillingHoliday,
  type BillingDailyShareGroup,
  type BillingCostCenter,
} from '@/lib/billing/billingApi';

type EditState = Partial<BillingCostCenter> & { name: string };
type PharmacyRow = {
  id: string;
  name?: string;
  trade_name?: string | null;
  legal_name?: string | null;
  cnpj?: string | null;
  billing_cost_center_id?: string | null;
};
type ShareGroupEditState = Partial<BillingDailyShareGroup> & { name: string; pharmacy_ids: string[] };

const empty: EditState = {
  name: '',
  code: '',
  cnpj: '',
  pharmacy_id: null,
  billing_pharmacy_id: null,
  split_coop_pct: 50,
  split_flux_pct: 50,
  active: true,
  cycle_closes_weekday: 7,
  cycle_review_weekday: 1,
  invoice_issue_weekday: 1,
  invoice_due_weekday: 3,
  invoice_due_week_offset: 0,
  driver_payment_weekday: 4,
  driver_payment_week_offset: 0,
  driver_payment_release_condition: 'invoice_paid_or_manager_release',
  allow_partial_driver_payment: false,
  block_c6_without_invoice_payment: true,
  invoice_holiday_policy: 'next_business_day',
  driver_payment_holiday_policy: 'previous_business_day',
  require_manager_release_reason: true,
  default_coverage_daily_billing_treatment: 'pending_audit',
};

const weekdayOptions = [
  { value: '1', label: 'Segunda-feira' },
  { value: '2', label: 'Terça-feira' },
  { value: '3', label: 'Quarta-feira' },
  { value: '4', label: 'Quinta-feira' },
  { value: '5', label: 'Sexta-feira' },
  { value: '6', label: 'Sábado' },
  { value: '7', label: 'Domingo' },
];

const weekOffsetOptions = [
  { value: '0', label: 'Mesma semana' },
  { value: '1', label: 'Semana seguinte' },
  { value: '2', label: 'Duas semanas depois' },
];

const holidayPolicyOptions = [
  { value: 'previous_business_day', label: 'Antecipar para dia útil anterior' },
  { value: 'next_business_day', label: 'Postergar para próximo dia útil' },
  { value: 'keep_requires_approval', label: 'Manter e exigir confirmação' },
];

const emptyShareGroup: ShareGroupEditState = {
  name: '',
  billing_cost_center_id: null,
  billing_pharmacy_id: null,
  daily_pharmacy_amount_cents: 0,
  daily_driver_payout_cents: null,
  allocation_rule: 'equal',
  active: true,
  pharmacy_ids: [],
};

export function BillingCostCenterPanel() {
  const qc = useQueryClient();
  const [edit, setEdit] = useState<EditState | null>(null);
  const [pharmacySearch, setPharmacySearch] = useState('');
  const [holidayDate, setHolidayDate] = useState('');
  const [holidayName, setHolidayName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [shareEdit, setShareEdit] = useState<ShareGroupEditState | null>(null);
  const listQuery = useQuery({ queryKey: ['billing', 'cost-centers', 'all'], queryFn: () => fetchCostCenters(false) });
  const shareGroupsQuery = useQuery({ queryKey: ['billing', 'daily-share-groups'], queryFn: () => fetchDailyShareGroups(false) });
  const holidaysQuery = useQuery({ queryKey: ['billing', 'holidays'], queryFn: fetchBillingHolidays });
  const pharmaciesQuery = useQuery({
    queryKey: ['pharmacies', 'billing-cost-center-picker', pharmacySearch],
    queryFn: () =>
      cadastroPageApi.fetchPharmacies({
        status: 'active',
        ...(pharmacySearch.trim() ? { search: pharmacySearch.trim() } : {}),
      }) as Promise<PharmacyRow[]>,
  });
  const groupPharmaciesQuery = useQuery({
    queryKey: ['pharmacies', 'daily-share-group-picker'],
    queryFn: () => cadastroPageApi.fetchPharmacies({ status: 'active' }) as Promise<PharmacyRow[]>,
  });

  const saveMut = useMutation({
    mutationFn: (row: EditState) => saveCostCenter(row),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'cost-centers'] });
      await qc.invalidateQueries({ queryKey: ['pharmacies'] });
      setEdit(null);
      setPharmacySearch('');
      setSaveError(null);
    },
    onError: (err) => {
      setSaveError(apiErrorMessage(err, 'Não foi possível salvar o centro de custo.'));
    },
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteCostCenter(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'cost-centers'] }),
  });

  const saveShareGroupMut = useMutation({
    mutationFn: (row: ShareGroupEditState) => saveDailyShareGroup(row),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['billing', 'daily-share-groups'] });
      setShareEdit(null);
    },
  });

  const deleteShareGroupMut = useMutation({
    mutationFn: (id: string) => deleteDailyShareGroup(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'daily-share-groups'] }),
  });

  const saveHolidayMut = useMutation({
    mutationFn: () => saveBillingHoliday({ holiday_date: holidayDate, name: holidayName.trim(), scope: 'workspace' }),
    onSuccess: async () => {
      setHolidayDate('');
      setHolidayName('');
      await qc.invalidateQueries({ queryKey: ['billing', 'holidays'] });
    },
  });

  const deleteHolidayMut = useMutation({
    mutationFn: (id: string) => deleteBillingHoliday(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'holidays'] }),
  });

  const rows = listQuery.data || [];
  const pharmacies = pharmaciesQuery.data || [];
  const groupPharmacies = groupPharmaciesQuery.data || [];
  const pharmacyOptions = pharmacies.slice(0, 80).map((p) => ({
    value: p.id,
    label: `${pharmacyDisplayName(p)}${p.cnpj ? ` · ${p.cnpj}` : ''}`,
  }));
  const allPharmacyOptions = groupPharmacies.map((p) => ({
    value: p.id,
    label: `${pharmacyDisplayName(p)}${p.cnpj ? ` · ${p.cnpj}` : ''}`,
  }));
  const costCenterOptions = rows.map((c) => ({ value: c.id, label: c.name }));
  const selectedShareCostCenterId = shareEdit?.billing_cost_center_id || '';
  const sharePharmacies = selectedShareCostCenterId
    ? groupPharmacies.filter((pharmacy) => pharmacy.billing_cost_center_id === selectedShareCostCenterId)
    : groupPharmacies;
  const sharePharmacyOptions = sharePharmacies.map((p) => ({
    value: p.id,
    label: `${pharmacyDisplayName(p)}${p.cnpj ? ` · ${p.cnpj}` : ''}`,
  }));
  const groupMemberIds = new Set(shareEdit?.pharmacy_ids || []);

  return (
    <div className={billingPageStackClassName}>
      <BillingSection
        title="Centros de custo"
        desc="Definem faturamento, boleto, entidade, DRE e agrupamento gerencial. Vincule cada farmácia a um CC no cadastro."
        icon={Building2}
        action={
          <Button
            size="sm"
            onClick={() => {
              setPharmacySearch('');
              setSaveError(null);
              setEdit({ ...empty });
            }}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Novo CC
          </Button>
        }
      >
      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">CNPJ</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3 text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{c.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{c.code || '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{c.cnpj || '—'}</td>
                <td className="px-4 py-2.5 text-xs">
                  <span className={c.active ? 'text-success' : 'text-muted-foreground'}>{c.active ? 'Ativo' : 'Inativo'}</span>
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    type="button"
                    onClick={() => {
                      setPharmacySearch('');
                      setSaveError(null);
                      setEdit({ ...c });
                    }}
                    className="mr-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                  >
                    <Pencil className="h-3 w-3" /> Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!confirm('Remover este centro de custo?')) return;
                      deleteMut.mutate(c.id);
                    }}
                    className="inline-flex items-center gap-1 text-xs text-destructive hover:underline"
                  >
                    <Trash2 className="h-3 w-3" /> Remover
                  </button>
                </td>
              </tr>
            ))}
            {!rows.length && !listQuery.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  Nenhum centro de custo cadastrado.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      </BillingSection>

      <BillingSection
        title="Grupos de rateio de diárias"
        desc="Definem quando uma diária é rateada e entre quais farmácias. Centro de custo continua gerencial/faturável."
        icon={Route}
        action={
          <Button size="sm" onClick={() => setShareEdit({ ...emptyShareGroup })}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Novo grupo
          </Button>
        }
      >
        <div className="overflow-hidden rounded-md border border-border/70">
          <table className="w-full text-xs">
            <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
              <tr>
                <th className="px-3 py-2">Grupo</th>
                <th className="px-3 py-2">Centro de custo</th>
                <th className="px-3 py-2">Farmácias</th>
                <th className="px-3 py-2 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {(shareGroupsQuery.data || []).map((group) => {
                const memberIds = (group.billing_daily_share_group_pharmacies || [])
                  .filter((m) => m.active !== false)
                  .map((m) => m.pharmacy_id);
                return (
                  <tr key={group.id} className="border-b border-border/40 last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{group.name}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {group.active ? 'Ativo' : 'Inativo'} · diária {group.daily_pharmacy_amount_cents ? `R$ ${(group.daily_pharmacy_amount_cents / 100).toFixed(2)}` : 'sem valor'}
                      </div>
                    </td>
                    <td className="px-3 py-2">{group.billing_cost_centers?.name || '—'}</td>
                    <td className="px-3 py-2">{memberIds.length}</td>
                    <td className="px-3 py-2 text-right">
                      <button
                        type="button"
                        className="mr-2 inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        onClick={() =>
                          setShareEdit({
                            ...group,
                            pharmacy_ids: memberIds,
                          })
                        }
                      >
                        <Pencil className="h-3 w-3" /> Editar
                      </button>
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 text-[11px] text-destructive hover:underline"
                        onClick={() => {
                          if (!confirm('Remover este grupo de rateio?')) return;
                          deleteShareGroupMut.mutate(group.id);
                        }}
                      >
                        <Trash2 className="h-3 w-3" /> Remover
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!shareGroupsQuery.data?.length ? (
                <tr>
                  <td colSpan={4} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Nenhum grupo de rateio cadastrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </BillingSection>

      <BillingSection
        title="Feriados para faturamento e pagamentos"
        desc="Datas usadas para antecipar ou postergar vencimentos de faturas e arquivos C6 conforme a política do centro de custo."
        icon={CalendarDays}
      >
        <div className="grid gap-2 md:grid-cols-[160px_1fr_auto]">
          <FormControl type="date" value={holidayDate} onChange={(e) => setHolidayDate(e.target.value)} />
          <FormControl
            value={holidayName}
            placeholder="Nome do feriado"
            onChange={(e) => setHolidayName(e.target.value)}
          />
          <Button
            size="sm"
            disabled={!holidayDate || !holidayName.trim() || saveHolidayMut.isPending}
            onClick={() => saveHolidayMut.mutate()}
          >
            Adicionar
          </Button>
        </div>
        <div className="mt-3 overflow-hidden rounded-md border border-border/70">
          <table className="w-full text-xs">
            <tbody>
              {(holidaysQuery.data || []).map((holiday) => (
                <tr key={holiday.id} className="border-b border-border/40 last:border-0">
                  <td className="px-3 py-2 font-mono">{holiday.holiday_date}</td>
                  <td className="px-3 py-2">{holiday.name}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => deleteHolidayMut.mutate(holiday.id)}
                      className="text-[11px] font-semibold text-destructive hover:underline"
                    >
                      Remover
                    </button>
                  </td>
                </tr>
              ))}
              {!holidaysQuery.data?.length ? (
                <tr>
                  <td colSpan={3} className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Nenhum feriado cadastrado.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </BillingSection>

      {edit && (
        <Dialog open onOpenChange={(v) => !v && setEdit(null)}>
          <BillingDialogContent
            title={`${edit.id ? 'Editar' : 'Novo'} centro de custo`}
            description="Vincule a farmácia representante e configure política de ciclo, faturamento e pagamento."
            className="sm:max-w-3xl"
            footer={
              <>
                <Button variant="outline" className="flex-1" onClick={() => setEdit(null)}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1 shadow-md"
                  disabled={!edit.name.trim() || saveMut.isPending}
                  onClick={() => {
                    setSaveError(null);
                    saveMut.mutate(edit);
                  }}
                >
                  Salvar
                </Button>
              </>
            }
          >
            <div className="grid gap-3">
              {saveError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {saveError}
                </div>
              ) : null}
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <BillingField label="Buscar farmácia cadastrada">
                <FormControl
                  className="mt-1 w-full text-xs"
                  value={pharmacySearch}
                  placeholder="Digite nome, fantasia ou CNPJ da farmácia..."
                  onChange={(e) => setPharmacySearch(e.target.value)}
                />
                <FormSearchCombobox
                  className="mt-2"
                  inputSize="sm"
                  value={edit.pharmacy_id || ''}
                  placeholder="Selecione uma farmácia para preencher o centro de custo"
                  emptyLabel="Nenhuma farmácia encontrada"
                  onChange={(value) => {
                    const pharmacy = pharmacies.find((p) => p.id === value);
                    setEdit({
                      ...edit,
                      pharmacy_id: value || null,
                      billing_pharmacy_id: value || null,
                      name: pharmacy ? pharmacyDisplayName(pharmacy) : edit.name,
                      cnpj: pharmacy?.cnpj || edit.cnpj || '',
                    });
                  }}
                  options={pharmacyOptions}
                />
                {edit.pharmacy_id ? (
                  <button
                    type="button"
                    className="mt-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setEdit({ ...edit, pharmacy_id: null })}
                  >
                    Remover vínculo da farmácia
                  </button>
                ) : null}
                </BillingField>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Ao salvar, a farmácia selecionada ficará vinculada a este centro de custo e será usada como representante de faturamento.
                </p>
              </div>
              <BillingField label="Nome">
                <FormControl value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </BillingField>
              <div className="grid grid-cols-2 gap-3">
                <BillingField label="Código">
                  <FormControl value={edit.code || ''} onChange={(e) => setEdit({ ...edit, code: e.target.value })} />
                </BillingField>
                <BillingField label="CNPJ">
                  <FormControl value={edit.cnpj || ''} onChange={(e) => setEdit({ ...edit, cnpj: e.target.value })} />
                </BillingField>
              </div>
              <BillingField label="Farmácia representante do faturamento">
                <FormSearchCombobox
                  className="mt-1"
                  inputSize="sm"
                  value={edit.billing_pharmacy_id || ''}
                  placeholder="Selecione a farmácia que receberá o relatório/fatura consolidado"
                  emptyLabel="Nenhuma farmácia encontrada"
                  onChange={(value) => setEdit({ ...edit, billing_pharmacy_id: value || null })}
                  options={allPharmacyOptions}
                />
                {edit.billing_pharmacy_id ? (
                  <button
                    type="button"
                    className="mt-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                    onClick={() => setEdit({ ...edit, billing_pharmacy_id: null })}
                  >
                    Usar cada farmácia individualmente
                  </button>
                ) : null}
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Quando preenchida, o relatório público consolida as lojas vinculadas ao centro de custo e permite filtrar por farmácia.
                </p>
              </BillingField>
              <BillingSwitchRow
                checked={edit.active !== false}
                onChange={(checked) => setEdit({ ...edit, active: checked })}
                label="Centro de custo ativo"
              />
              <div className="rounded-lg border border-border bg-background/50 p-3">
                <p className="mb-3 text-xs font-semibold text-foreground">Política de ciclo e pagamento</p>
                <div className="grid gap-3 md:grid-cols-2">
                  <BillingField label="Fechamento do ciclo">
                    <FormSelect
                      size="sm"
                      value={String(edit.cycle_closes_weekday ?? 7)}
                      onChange={(v) => setEdit({ ...edit, cycle_closes_weekday: Number(v) })}
                      options={weekdayOptions}
                    />
                  </BillingField>
                  <BillingField label="Apuração/conferência">
                    <FormSelect
                      size="sm"
                      value={String(edit.cycle_review_weekday ?? 1)}
                      onChange={(v) => setEdit({ ...edit, cycle_review_weekday: Number(v) })}
                      options={weekdayOptions}
                    />
                  </BillingField>
                  <BillingField label="Faturamento da farmácia">
                    <FormSelect
                      size="sm"
                      value={String(edit.invoice_issue_weekday ?? 1)}
                      onChange={(v) => setEdit({ ...edit, invoice_issue_weekday: Number(v) })}
                      options={weekdayOptions}
                    />
                  </BillingField>
                  <BillingField label="Vencimento da fatura">
                    <div className="grid grid-cols-2 gap-2">
                      <FormSelect
                        size="sm"
                        value={String(edit.invoice_due_weekday ?? 3)}
                        onChange={(v) => setEdit({ ...edit, invoice_due_weekday: Number(v) })}
                        options={weekdayOptions}
                      />
                      <FormSelect
                        size="sm"
                        value={String(edit.invoice_due_week_offset ?? 0)}
                        onChange={(v) => setEdit({ ...edit, invoice_due_week_offset: Number(v) })}
                        options={weekOffsetOptions}
                      />
                    </div>
                  </BillingField>
                  <BillingField label="Pagamento dos entregadores">
                    <div className="grid grid-cols-2 gap-2">
                      <FormSelect
                        size="sm"
                        value={String(edit.driver_payment_weekday ?? 4)}
                        onChange={(v) => setEdit({ ...edit, driver_payment_weekday: Number(v) })}
                        options={weekdayOptions}
                      />
                      <FormSelect
                        size="sm"
                        value={String(edit.driver_payment_week_offset ?? 0)}
                        onChange={(v) => setEdit({ ...edit, driver_payment_week_offset: Number(v) })}
                        options={weekOffsetOptions}
                      />
                    </div>
                  </BillingField>
                  <BillingField label="Liberação do pagamento">
                    <FormSelect
                      size="sm"
                      value={edit.driver_payment_release_condition || 'invoice_paid_or_manager_release'}
                      onChange={(v) =>
                        setEdit({
                          ...edit,
                          driver_payment_release_condition: v as BillingCostCenter['driver_payment_release_condition'],
                        })
                      }
                      options={[
                        { value: 'invoice_paid_or_manager_release', label: 'Baixa da fatura ou gestor' },
                        { value: 'invoice_paid', label: 'Somente baixa da fatura' },
                        { value: 'manager_release', label: 'Somente gestor' },
                        { value: 'none', label: 'Sem bloqueio' },
                      ]}
                    />
                  </BillingField>
                  <BillingField label="Feriado na fatura">
                    <FormSelect
                      size="sm"
                      value={edit.invoice_holiday_policy || 'next_business_day'}
                      onChange={(v) =>
                        setEdit({ ...edit, invoice_holiday_policy: v as BillingCostCenter['invoice_holiday_policy'] })
                      }
                      options={holidayPolicyOptions}
                    />
                  </BillingField>
                  <BillingField label="Feriado no pagamento">
                    <FormSelect
                      size="sm"
                      value={edit.driver_payment_holiday_policy || 'previous_business_day'}
                      onChange={(v) =>
                        setEdit({
                          ...edit,
                          driver_payment_holiday_policy: v as BillingCostCenter['driver_payment_holiday_policy'],
                        })
                      }
                      options={holidayPolicyOptions}
                    />
                  </BillingField>
                </div>
                <div className="mt-3 grid gap-2 text-xs md:grid-cols-2">
                  <BillingSwitchRow
                    checked={edit.block_c6_without_invoice_payment !== false}
                    onChange={(checked) => setEdit({ ...edit, block_c6_without_invoice_payment: checked })}
                    label="Bloquear C6 sem baixa da fatura"
                  />
                  <BillingSwitchRow
                    checked={edit.allow_partial_driver_payment === true}
                    onChange={(checked) => setEdit({ ...edit, allow_partial_driver_payment: checked })}
                    label="Permitir pagamento parcial por farmácia"
                  />
                  <BillingSwitchRow
                    checked={edit.require_manager_release_reason !== false}
                    onChange={(checked) => setEdit({ ...edit, require_manager_release_reason: checked })}
                    label="Exigir justificativa do gestor"
                  />
                </div>
              </div>
              {saveMut.isError && (
                <p className="text-xs text-destructive">{(saveMut.error as Error).message || 'Erro ao salvar'}</p>
              )}
            </div>
          </BillingDialogContent>
        </Dialog>
      )}

      {shareEdit && (
        <Dialog open onOpenChange={(v) => !v && setShareEdit(null)}>
          <BillingDialogContent
            title={`${shareEdit.id ? 'Editar' : 'Novo'} grupo de rateio de diárias`}
            description="Defina quais farmácias compartilham a diária e qual representante consolida o faturamento."
            className="sm:max-w-4xl"
            footer={
              <>
                <Button variant="outline" className="flex-1" onClick={() => setShareEdit(null)}>
                  Cancelar
                </Button>
                <Button
                  className="flex-1 shadow-md"
                  disabled={!shareEdit.name.trim() || !shareEdit.pharmacy_ids.length || saveShareGroupMut.isPending}
                  onClick={() => saveShareGroupMut.mutate(shareEdit)}
                >
                  Salvar grupo
                </Button>
              </>
            }
          >
            <div className="grid gap-3">
              <BillingField label="Nome do grupo" required>
                <FormControl
                  value={shareEdit.name}
                  onChange={(e) => setShareEdit({ ...shareEdit, name: e.target.value })}
                  placeholder="Ex: Indiana Uberlândia Centro"
                />
              </BillingField>
              <div className="grid gap-3 md:grid-cols-2">
                <BillingField label="Centro de custo">
                  <FormSearchCombobox
                    inputSize="sm"
                    value={shareEdit.billing_cost_center_id || ''}
                    placeholder="Buscar centro de custo..."
                    emptyLabel="Nenhum centro de custo encontrado"
                    onChange={(v) => {
                      const nextCostCenterId = v || null;
                      const allowedIds = new Set(
                        nextCostCenterId
                          ? groupPharmacies
                              .filter((pharmacy) => pharmacy.billing_cost_center_id === nextCostCenterId)
                              .map((pharmacy) => pharmacy.id)
                          : groupPharmacies.map((pharmacy) => pharmacy.id)
                      );
                      setShareEdit({
                        ...shareEdit,
                        billing_cost_center_id: nextCostCenterId,
                        billing_pharmacy_id:
                          shareEdit.billing_pharmacy_id && allowedIds.has(shareEdit.billing_pharmacy_id)
                            ? shareEdit.billing_pharmacy_id
                            : null,
                        pharmacy_ids: (shareEdit.pharmacy_ids || []).filter((id) => allowedIds.has(id)),
                      });
                    }}
                    options={costCenterOptions}
                  />
                  {shareEdit.billing_cost_center_id ? (
                    <button
                      type="button"
                      className="mt-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() =>
                        setShareEdit({
                          ...shareEdit,
                          billing_cost_center_id: null,
                          billing_pharmacy_id: null,
                        })
                      }
                    >
                      Remover centro de custo
                    </button>
                  ) : null}
                </BillingField>
                <BillingField label="Farmácia representante">
                  <FormSearchCombobox
                    inputSize="sm"
                    value={shareEdit.billing_pharmacy_id || ''}
                    placeholder="Buscar farmácia representante..."
                    emptyLabel="Nenhuma farmácia encontrada"
                    onChange={(v) => setShareEdit({ ...shareEdit, billing_pharmacy_id: v || null })}
                    options={sharePharmacyOptions}
                  />
                  {shareEdit.billing_pharmacy_id ? (
                    <button
                      type="button"
                      className="mt-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
                      onClick={() => setShareEdit({ ...shareEdit, billing_pharmacy_id: null })}
                    >
                      Remover representante
                    </button>
                  ) : null}
                </BillingField>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <BillingField label="Valor cobrado por diária">
                  <BrCentsInput
                    value={shareEdit.daily_pharmacy_amount_cents ?? 0}
                    onChange={(cents) => setShareEdit({ ...shareEdit, daily_pharmacy_amount_cents: cents ?? 0 })}
                  />
                </BillingField>
                <BillingField label="Repasse referência ao entregador">
                  <BrCentsInput
                    value={shareEdit.daily_driver_payout_cents ?? null}
                    onChange={(cents) => setShareEdit({ ...shareEdit, daily_driver_payout_cents: cents })}
                  />
                </BillingField>
              </div>
              <BillingSwitchRow
                checked={shareEdit.active !== false}
                onChange={(checked) => setShareEdit({ ...shareEdit, active: checked })}
                label="Grupo ativo"
              />
              <div className="rounded-xl border border-border bg-background/40 p-3">
                <div className="mb-2">
                  <p className="text-xs font-medium text-muted-foreground">Farmácias participantes</p>
                  <p className="text-[11px] text-muted-foreground">
                    A diária só será rateada entre as farmácias selecionadas neste grupo.
                    {selectedShareCostCenterId
                      ? ` Exibindo ${sharePharmacies.length} farmácia(s) do centro de custo selecionado.`
                      : ' Selecione um centro de custo para restringir a lista.'}
                  </p>
                </div>
                <div className="grid max-h-64 gap-1 overflow-y-auto pr-1 md:grid-cols-2">
                  {sharePharmacies.map((pharmacy) => (
                    <label key={pharmacy.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 text-xs hover:bg-muted">
                      <input
                        className="mt-0.5"
                        type="checkbox"
                        checked={groupMemberIds.has(pharmacy.id)}
                        onChange={(e) => {
                          const next = new Set(shareEdit.pharmacy_ids || []);
                          if (e.target.checked) next.add(pharmacy.id);
                          else next.delete(pharmacy.id);
                          setShareEdit({ ...shareEdit, pharmacy_ids: [...next] });
                        }}
                      />
                      <span className="min-w-0 break-words leading-snug">
                        {pharmacyDisplayName(pharmacy)}
                        {pharmacy.cnpj ? <span className="text-muted-foreground"> · {pharmacy.cnpj}</span> : null}
                      </span>
                    </label>
                  ))}
                  {!sharePharmacies.length ? (
                    <BillingEmptyState className="col-span-full py-6">
                      Nenhuma farmácia ativa encontrada para este centro de custo.
                    </BillingEmptyState>
                  ) : null}
                </div>
              </div>
              {saveShareGroupMut.isError ? (
                <p className="text-xs text-destructive">
                  {apiErrorMessage(saveShareGroupMut.error, 'Erro ao salvar grupo de rateio.')}
                </p>
              ) : null}
            </div>
          </BillingDialogContent>
        </Dialog>
      )}
    </div>
  );
}

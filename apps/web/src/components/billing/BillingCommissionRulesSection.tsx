'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { BillingField, BillingFormSection, BillingSwitchRow } from '@/components/billing/BillingPrimitives';
import {
  fetchCommissionRules,
  saveCommissionRule,
  type BillingCommissionRule,
  type BillingCommercialPartner,
} from '@/lib/billing/billingApi';

type Props = {
  partnerId: string;
  partner: BillingCommercialPartner;
};

const emptyRule = (role: BillingCommissionRule['role_type']): BillingCommissionRule => ({
  role_type: role,
  calculation_basis: 'percent_deal_value',
  percent_value: 5,
  fixed_cents: null,
  active: true,
});

export function BillingCommissionRulesSection({ partnerId, partner }: Props) {
  const qc = useQueryClient();
  const rulesQuery = useQuery({
    queryKey: ['billing', 'commission-rules', partnerId],
    queryFn: () => fetchCommissionRules(partnerId),
    enabled: !!partnerId,
  });

  const showSales = partner.partner_kind === 'sales_agent' || partner.partner_kind === 'both';
  const showReferrer = partner.partner_kind === 'referrer' || partner.partner_kind === 'both';

  return (
    <BillingFormSection
      title="Regras de comissão"
      desc="Aplicadas na conversão do lead (atividade ganho). Vencimento do AP consolidado: dia 15 do mês seguinte."
      className="mt-8"
    >
      {showSales ? (
        <RuleEditor
          partnerId={partnerId}
          role="sales_agent"
          title="Comissão de venda"
          initial={rulesQuery.data?.find((r) => r.role_type === 'sales_agent')}
          onSaved={() => qc.invalidateQueries({ queryKey: ['billing', 'commission-rules', partnerId] })}
        />
      ) : null}
      {showReferrer ? (
        <RuleEditor
          partnerId={partnerId}
          role="referrer"
          title="Comissão de indicação"
          initial={rulesQuery.data?.find((r) => r.role_type === 'referrer')}
          onSaved={() => qc.invalidateQueries({ queryKey: ['billing', 'commission-rules', partnerId] })}
        />
      ) : null}
    </BillingFormSection>
  );
}

function RuleEditor({
  partnerId,
  role,
  title,
  initial,
  onSaved,
}: {
  partnerId: string;
  role: BillingCommissionRule['role_type'];
  title: string;
  initial?: BillingCommissionRule;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<BillingCommissionRule>(() => initial || emptyRule(role));

  useEffect(() => {
    if (initial) setForm(initial);
  }, [initial]);

  const saveMut = useMutation({
    mutationFn: () => saveCommissionRule(partnerId, role, form),
    onSuccess: () => onSaved(),
  });

  const set = <K extends keyof BillingCommissionRule>(key: K, v: BillingCommissionRule[K]) =>
    setForm((prev) => ({ ...prev, [key]: v }));

  return (
    <div className="rounded-xl border border-border bg-background/40 p-4">
      <h4 className="mb-3 text-sm font-medium">{title}</h4>
      <div className="grid gap-3 md:grid-cols-3">
        <BillingField label="Base de cálculo">
          <FormSelect
            className="mt-1 w-full"
            value={form.calculation_basis}
            onChange={(value) =>
              set('calculation_basis', value as BillingCommissionRule['calculation_basis'])
            }
            options={[
              { value: 'percent_deal_value', label: '% do valor do negócio' },
              { value: 'fixed_per_conversion', label: 'Valor fixo por conversão' },
            ]}
          />
        </BillingField>
        {form.calculation_basis === 'percent_deal_value' ? (
          <BillingField label="Percentual (%)">
            <FormControl
              type="number"
              className="mt-1 w-full"
              value={form.percent_value ?? ''}
              onChange={(e) => set('percent_value', e.target.value === '' ? null : Number(e.target.value))}
            />
          </BillingField>
        ) : (
          <BillingField label="Valor fixo (R$)">
            <FormControl
              className="mt-1 w-full"
              value={form.fixed_cents ? String(form.fixed_cents / 100) : ''}
              onChange={(e) =>
                set('fixed_cents', Math.round(Number(e.target.value.replace(',', '.') || 0) * 100))
              }
            />
          </BillingField>
        )}
        <div className="flex items-end">
          <BillingSwitchRow checked={form.active} onChange={(checked) => set('active', checked)} label="Regra ativa" />
        </div>
      </div>
      <div className="mt-3 flex justify-end">
        <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
          Salvar regra
        </Button>
      </div>
    </div>
  );
}

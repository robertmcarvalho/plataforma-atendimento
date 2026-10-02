'use client';

import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BadgeDollarSign, FileText, UserRound, Users } from 'lucide-react';
import { BillingField, BillingFormSection, BillingSwitchRow } from '@/components/billing/BillingPrimitives';
import type { BillingShareholder } from '@/lib/billing/billingApi';

type Props = {
  value: BillingShareholder;
  onChange: (next: BillingShareholder) => void;
};

export function BillingShareholderForm({ value, onChange }: Props) {
  const set = <K extends keyof BillingShareholder>(key: K, v: BillingShareholder[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-4">
      <BillingFormSection title="Identificação societária" desc="Entidade, nome, documento e participação." icon={Users}>
        <div className="grid gap-3 md:grid-cols-2">
        <BillingField label="Entidade" required>
          <FormSelect
            value={value.entity_type}
            onChange={(next) => set('entity_type', next as 'coop' | 'flux')}
            options={[
              { value: 'coop', label: 'CoopMob' },
              { value: 'flux', label: 'Flux Farma' },
            ]}
          />
        </BillingField>
        <BillingField label="Nome completo" required>
          <FormControl className="w-full" value={value.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
        </BillingField>
        <BillingField label="CPF/CNPJ">
          <FormControl className="w-full" value={value.cpf_cnpj || ''} onChange={(e) => set('cpf_cnpj', e.target.value)} />
        </BillingField>
        <BillingField label="Participação (%)">
          <FormControl type="number" className="w-full" value={value.ownership_pct ?? ''} onChange={(e) => set('ownership_pct', e.target.value === '' ? null : Number(e.target.value))} />
        </BillingField>
        <BillingField label="Pró-labore mensal (R$)">
          <FormControl
            className="w-full"
            value={value.pro_labore_default_cents ? String(value.pro_labore_default_cents / 100) : ''}
            onChange={(e) => set('pro_labore_default_cents', Math.round(Number(e.target.value.replace(',', '.') || 0) * 100))}
          />
        </BillingField>
        <div className="grid gap-2 md:col-span-2 md:grid-cols-2">
          <BillingSwitchRow
            checked={value.is_administrator}
            onChange={(checked) => set('is_administrator', checked)}
            label="Sócio administrador"
          />
          <BillingSwitchRow checked={value.active} onChange={(checked) => set('active', checked)} label="Sócio ativo" />
        </div>
        </div>
      </BillingFormSection>

      <BillingFormSection title="Contato" desc="Canais e datas de vínculo." icon={UserRound}>
        <div className="grid gap-3 md:grid-cols-2">
        <BillingField label="E-mail">
          <FormControl type="email" className="w-full" value={value.email || ''} onChange={(e) => set('email', e.target.value)} />
        </BillingField>
        <BillingField label="Telefone">
          <FormControl className="w-full" value={value.phone || ''} onChange={(e) => set('phone', e.target.value)} />
        </BillingField>
        <BillingField label="Início vínculo">
          <FormControl type="date" className="w-full" value={value.contract_started_at || ''} onChange={(e) => set('contract_started_at', e.target.value)} />
        </BillingField>
        <BillingField label="Desligamento">
          <FormControl type="date" className="w-full" value={value.inactive_at || ''} onChange={(e) => set('inactive_at', e.target.value || null)} />
        </BillingField>
        </div>
      </BillingFormSection>

      <BillingFormSection title="Pagamento" desc="Chave PIX usada nos relatórios e pagamentos." icon={BadgeDollarSign}>
        <div className="grid gap-3 md:grid-cols-2">
          <BillingField label="Chave PIX">
            <FormControl className="w-full" value={value.pix_key || ''} onChange={(e) => set('pix_key', e.target.value)} />
          </BillingField>
          <BillingField label="Tipo PIX">
            <FormSelect
              value={value.pix_key_type || 'cpf'}
              onChange={(next) => set('pix_key_type', next)}
              options={[
                { value: 'cpf', label: 'CPF' },
                { value: 'cnpj', label: 'CNPJ' },
                { value: 'email', label: 'E-mail' },
                { value: 'phone', label: 'Telefone' },
                { value: 'random', label: 'Aleatória' },
              ]}
            />
          </BillingField>
        </div>
      </BillingFormSection>

      <BillingFormSection title="Observações" desc="Anotações internas sobre o sócio." icon={FileText}>
        <textarea
          className={formTextareaClassName}
          value={value.notes || ''}
          onChange={(e) => set('notes', e.target.value)}
        />
      </BillingFormSection>
    </div>
  );
}

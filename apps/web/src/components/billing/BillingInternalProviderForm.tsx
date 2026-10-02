'use client';

import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { FormSearchCombobox } from '@/components/form/FormSearchCombobox';
import { BadgeDollarSign, Building2, FileText, MapPin, UserRound } from 'lucide-react';
import { BillingField, BillingFormSection, BillingSwitchRow } from '@/components/billing/BillingPrimitives';
import type { BillingInternalProvider } from '@/lib/billing/billingApi';

type Props = {
  value: BillingInternalProvider;
  onChange: (next: BillingInternalProvider) => void;
  costCenters?: { id: string; name: string }[];
};

export function BillingInternalProviderForm({ value, onChange, costCenters = [] }: Props) {
  const set = <K extends keyof BillingInternalProvider>(key: K, v: BillingInternalProvider[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-4">
      <BillingFormSection title="Identificação" desc="Dados principais do prestador." icon={UserRound}>
        <div className="grid gap-3 md:grid-cols-2">
        <BillingField label="Nome completo" required>
          <FormControl className="w-full" value={value.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
        </BillingField>
        <BillingField label="Nome fantasia">
          <FormControl className="w-full" value={value.trade_name || ''} onChange={(e) => set('trade_name', e.target.value)} />
        </BillingField>
        <BillingField label="CPF/CNPJ">
          <FormControl className="w-full" value={value.cpf_cnpj || ''} onChange={(e) => set('cpf_cnpj', e.target.value)} />
        </BillingField>
        <BillingField label="Cargo / função">
          <FormControl className="w-full" value={value.role_title || ''} onChange={(e) => set('role_title', e.target.value)} />
        </BillingField>
        </div>
      </BillingFormSection>

      <BillingFormSection title="Contato e contrato" desc="Canais de contato e início do vínculo." icon={Building2}>
        <div className="grid gap-3 md:grid-cols-2">
        <BillingField label="E-mail">
          <FormControl type="email" className="w-full" value={value.email || ''} onChange={(e) => set('email', e.target.value)} />
        </BillingField>
        <BillingField label="Telefone">
          <FormControl className="w-full" value={value.phone || ''} onChange={(e) => set('phone', e.target.value)} />
        </BillingField>
        <BillingField label="E-mail financeiro">
          <FormControl type="email" className="w-full" value={value.financial_email || ''} onChange={(e) => set('financial_email', e.target.value)} />
        </BillingField>
        <BillingField label="Início contrato">
          <FormControl type="date" className="w-full" value={value.contract_started_at || ''} onChange={(e) => set('contract_started_at', e.target.value)} />
        </BillingField>
        </div>
      </BillingFormSection>

      <BillingFormSection title="Endereço" desc="Endereço cadastral do prestador." icon={MapPin}>
        <div className="grid gap-3 md:grid-cols-3">
        <BillingField label="CEP">
          <FormControl className="w-full" value={value.address_cep || ''} onChange={(e) => set('address_cep', e.target.value)} />
        </BillingField>
        <BillingField label="Cidade">
          <FormControl className="w-full" value={value.address_city || ''} onChange={(e) => set('address_city', e.target.value)} />
        </BillingField>
        <BillingField label="UF">
          <FormControl className="w-full" maxLength={2} value={value.address_state || ''} onChange={(e) => set('address_state', e.target.value.toUpperCase())} />
        </BillingField>
        <div className="md:col-span-3">
          <BillingField label="Logradouro">
            <FormControl className="w-full" value={value.address_street || ''} onChange={(e) => set('address_street', e.target.value)} />
          </BillingField>
        </div>
        </div>
      </BillingFormSection>

      <BillingFormSection title="Pagamento e alocação" desc="PIX, entidade pagadora, centro de custo e honorário padrão." icon={BadgeDollarSign}>
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
        <BillingField label="Entidade pagadora">
          <FormSelect
            value={value.default_entity}
            onChange={(next) => set('default_entity', next as 'coop' | 'flux')}
            options={[
              { value: 'coop', label: 'CoopMob' },
              { value: 'flux', label: 'Flux Farma' },
            ]}
          />
        </BillingField>
        <BillingField label="Centro de custo default">
          <FormSearchCombobox
            value={value.default_cost_center_id || ''}
            placeholder="Buscar centro de custo..."
            emptyLabel="Nenhum centro de custo encontrado"
            onChange={(next) => set('default_cost_center_id', next || null)}
            options={costCenters.map((c) => ({ value: c.id, label: c.name }))}
          />
          {value.default_cost_center_id ? (
            <button
              type="button"
              className="mt-1 text-[11px] text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => set('default_cost_center_id', null)}
            >
              Remover centro de custo
            </button>
          ) : null}
        </BillingField>
        <BillingField label="Honorário mensal default (R$)">
          <FormControl
            className="w-full"
            value={value.default_monthly_cents != null ? String(value.default_monthly_cents / 100) : ''}
            onChange={(e) => set('default_monthly_cents', e.target.value ? Math.round(Number(e.target.value.replace(',', '.')) * 100) : null)}
          />
        </BillingField>
        <div className="flex items-end">
          <BillingSwitchRow checked={value.active} onChange={(checked) => set('active', checked)} label="Prestador ativo" />
        </div>
        </div>
      </BillingFormSection>

      <BillingFormSection title="Observações" desc="Anotações internas sobre o cadastro." icon={FileText}>
        <textarea
          className={formTextareaClassName}
          value={value.notes || ''}
          onChange={(e) => set('notes', e.target.value)}
        />
      </BillingFormSection>
    </div>
  );
}

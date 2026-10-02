'use client';

import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BadgeDollarSign, FileText, Handshake, UserRound } from 'lucide-react';
import { BillingField, BillingFormSection, BillingSwitchRow } from '@/components/billing/BillingPrimitives';
import type { BillingCommercialPartner } from '@/lib/billing/billingApi';

type Props = {
  value: BillingCommercialPartner;
  onChange: (next: BillingCommercialPartner) => void;
};

const KIND_LABELS: Record<BillingCommercialPartner['partner_kind'], string> = {
  sales_agent: 'Agente de vendas',
  referrer: 'Indicador',
  both: 'Vendas e indicação',
};

export function BillingCommercialPartnerForm({ value, onChange }: Props) {
  const set = <K extends keyof BillingCommercialPartner>(key: K, v: BillingCommercialPartner[K]) =>
    onChange({ ...value, [key]: v });

  return (
    <div className="space-y-4">
      <BillingFormSection title="Identificação comercial" desc="Dados principais e tipo de parceria." icon={Handshake}>
        <div className="grid gap-3 md:grid-cols-2">
        <BillingField label="Nome" required>
          <FormControl className="w-full" value={value.legal_name} onChange={(e) => set('legal_name', e.target.value)} />
        </BillingField>
        <BillingField label="Nome fantasia">
          <FormControl className="w-full" value={value.trade_name || ''} onChange={(e) => set('trade_name', e.target.value)} />
        </BillingField>
        <BillingField label="CPF/CNPJ">
          <FormControl className="w-full" value={value.cpf_cnpj || ''} onChange={(e) => set('cpf_cnpj', e.target.value)} />
        </BillingField>
        <BillingField label="Tipo de parceiro" required>
          <FormSelect
            value={value.partner_kind}
            onChange={(next) => set('partner_kind', next as BillingCommercialPartner['partner_kind'])}
            options={(Object.keys(KIND_LABELS) as BillingCommercialPartner['partner_kind'][]).map((k) => ({
              value: k,
              label: KIND_LABELS[k],
            }))}
          />
        </BillingField>
        <BillingField label="Entidade padrão">
          <FormSelect
            value={value.default_entity}
            onChange={(next) => set('default_entity', next as 'coop' | 'flux')}
            options={[
              { value: 'coop', label: 'CoopMob' },
              { value: 'flux', label: 'Flux Farma' },
            ]}
          />
        </BillingField>
        <div className="flex items-end">
          <BillingSwitchRow checked={value.active} onChange={(checked) => set('active', checked)} label="Parceiro ativo" />
        </div>
        </div>
      </BillingFormSection>

      <BillingFormSection title="Contato e vínculo" desc="Canais de contato e datas de início/desligamento." icon={UserRound}>
        <div className="grid gap-3 md:grid-cols-2">
        <BillingField label="E-mail">
          <FormControl type="email" className="w-full" value={value.email || ''} onChange={(e) => set('email', e.target.value)} />
        </BillingField>
        <BillingField label="Telefone">
          <FormControl className="w-full" value={value.phone || ''} onChange={(e) => set('phone', e.target.value)} />
        </BillingField>
        <BillingField label="Início vínculo">
          <FormControl
            type="date"
            className="w-full"
            value={value.contract_started_at || ''}
            onChange={(e) => set('contract_started_at', e.target.value)}
          />
        </BillingField>
        <BillingField label="Desligamento">
          <FormControl
            type="date"
            className="w-full"
            value={value.inactive_at || ''}
            onChange={(e) => set('inactive_at', e.target.value || null)}
          />
        </BillingField>
        </div>
      </BillingFormSection>

      <BillingFormSection title="Pagamento" desc="Chave PIX usada para liquidação de comissões." icon={BadgeDollarSign}>
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

      <BillingFormSection title="Observações" desc="Anotações internas sobre o parceiro." icon={FileText}>
        <textarea
          className={formTextareaClassName}
          value={value.notes || ''}
          onChange={(e) => set('notes', e.target.value)}
        />
      </BillingFormSection>
    </div>
  );
}

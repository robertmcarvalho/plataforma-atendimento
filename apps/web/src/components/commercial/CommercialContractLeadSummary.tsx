'use client';

import { CommercialReviveField, commercialReviveSectionClassName } from '@/components/commercial/CommercialRevivePrimitives';
import { formatBrazilPhone, formatCpf } from '@/lib/brFormat';
import { maskCnpj } from '@/lib/commercial/commercialFormat';
import { contractFormSnapshot } from '@/lib/commercial/contractOnboardingDisplay';
import type { CommercialLead } from '@/lib/commercial/types';
import { cn } from '@/lib/utils';

type Props = {
  lead: CommercialLead;
  compact?: boolean;
  className?: string;
};

function field(label: string, value: unknown, mono?: boolean) {
  const text = value != null && String(value).trim() ? String(value) : '—';
  return <CommercialReviveField key={label} label={label} value={text} mono={mono} />;
}

export function CommercialContractLeadSummary({ lead, compact, className }: Props) {
  const snapshot = contractFormSnapshot(lead);
  if (!snapshot) return null;

  return (
    <section className={cn(commercialReviveSectionClassName, compact && 'p-4', className)}>
      <h3 className="mb-3 text-sm font-semibold tracking-tight">Formulário preenchido pelo lead</h3>
      <div className={cn('grid gap-3 text-xs', compact ? 'grid-cols-1' : 'grid-cols-2')}>
        {field('CNPJ', maskCnpj(String(snapshot.cnpj || lead.cnpj || '')), true)}
        {field('Representante legal', snapshot.legal_representative_name)}
        {field('CPF', formatCpf(String(snapshot.legal_representative_cpf || '')), true)}
        {field('E-mail', snapshot.legal_representative_email)}
        {field('Telefone', formatBrazilPhone(String(snapshot.legal_representative_phone || '')), true)}
        {field('CEP', snapshot.address_cep, true)}
        {field('Logradouro', snapshot.address_street)}
        {field('Número', snapshot.address_number)}
        {field('Bairro', snapshot.address_neighborhood)}
        {field('Complemento', snapshot.address_complement)}
        {field('Cidade', snapshot.city)}
        {field('UF', snapshot.state)}
        {field('Expedição — nome', snapshot.contact_expedition_name)}
        {field('Expedição — telefone', formatBrazilPhone(String(snapshot.contact_expedition_phone || '')), true)}
        {field('Financeiro — nome', snapshot.contact_financial_name)}
        {field('Financeiro — telefone', formatBrazilPhone(String(snapshot.contact_financial_phone || '')), true)}
      </div>
    </section>
  );
}

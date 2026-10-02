'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Handshake } from 'lucide-react';
import { BillingCadastroPage } from '@/components/billing/BillingPrimitives';
import { BillingCommercialPartnerForm } from '@/components/billing/BillingCommercialPartnerForm';
import { Button } from '@/components/ui/button';
import { saveCommercialPartner, type BillingCommercialPartner } from '@/lib/billing/billingApi';

const empty: BillingCommercialPartner = {
  legal_name: '',
  partner_kind: 'sales_agent',
  default_entity: 'coop',
  active: true,
};

export default function BillingNewParceiroPage() {
  const router = useRouter();
  const [form, setForm] = useState(empty);

  const saveMut = useMutation({
    mutationFn: () => saveCommercialPartner(form),
    onSuccess: (row) => router.push(`/billing/cadastro/parceiros/${row.id}`),
  });

  return (
    <BillingCadastroPage
      backHref="/billing/cadastros?tab=parceiros"
      backLabel="Voltar para cadastros"
      title="Novo parceiro comercial"
      description="Cadastre parceiros de vendas e indicação usados nas regras de comissão comercial."
      icon={Handshake}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => router.push('/billing/cadastros?tab=parceiros')}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={!form.legal_name.trim() || saveMut.isPending}>
            Salvar parceiro
          </Button>
        </>
      }
    >
      <BillingCommercialPartnerForm value={form} onChange={setForm} />
    </BillingCadastroPage>
  );
}

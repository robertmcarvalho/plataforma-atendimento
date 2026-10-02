'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BriefcaseBusiness } from 'lucide-react';
import { BillingCadastroPage } from '@/components/billing/BillingPrimitives';
import { BillingInternalProviderForm } from '@/components/billing/BillingInternalProviderForm';
import { Button } from '@/components/ui/button';
import { fetchCostCenters, saveInternalProvider, type BillingInternalProvider } from '@/lib/billing/billingApi';

const empty: BillingInternalProvider = {
  legal_name: '',
  default_entity: 'coop',
  active: true,
  contract_type: 'pj',
};

export default function BillingNewPrestadorPage() {
  const router = useRouter();
  const [form, setForm] = useState(empty);
  const ccQuery = useQuery({ queryKey: ['billing', 'cost-centers', 'active'], queryFn: () => fetchCostCenters(true) });

  const saveMut = useMutation({
    mutationFn: () => saveInternalProvider(form),
    onSuccess: (row) => router.push(`/billing/cadastro/prestadores/${row.id}`),
  });

  return (
    <BillingCadastroPage
      backHref="/billing/cadastros?tab=prestadores"
      backLabel="Voltar para cadastros"
      title="Novo prestador"
      description="Cadastre prestadores internos usados em pagamentos, DRE e rotinas administrativas do faturamento."
      icon={BriefcaseBusiness}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => router.push('/billing/cadastros?tab=prestadores')}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={!form.legal_name.trim() || saveMut.isPending}>
            Salvar prestador
          </Button>
        </>
      }
    >
      <BillingInternalProviderForm value={form} onChange={setForm} costCenters={ccQuery.data || []} />
    </BillingCadastroPage>
  );
}

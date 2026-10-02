'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { BillingCadastroPage } from '@/components/billing/BillingPrimitives';
import { BillingShareholderForm } from '@/components/billing/BillingShareholderForm';
import { Button } from '@/components/ui/button';
import { saveShareholder, type BillingShareholder } from '@/lib/billing/billingApi';

const empty: BillingShareholder = {
  entity_type: 'coop',
  legal_name: '',
  pro_labore_default_cents: 0,
  is_administrator: false,
  active: true,
};

export default function BillingNewSocioPage() {
  const router = useRouter();
  const [form, setForm] = useState(empty);

  const saveMut = useMutation({
    mutationFn: () => saveShareholder(form),
    onSuccess: (row) => router.push(`/billing/cadastro/socios/${row.id}`),
  });

  return (
    <BillingCadastroPage
      backHref="/billing/cadastros?tab=socios"
      backLabel="Voltar para cadastros"
      title="Novo sócio"
      description="Cadastre sócios, participação, pró-labore e dados de pagamento usados nos relatórios do faturamento."
      icon={Users}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => router.push('/billing/cadastros?tab=socios')}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={!form.legal_name.trim() || saveMut.isPending}>
            Salvar sócio
          </Button>
        </>
      }
    >
      <BillingShareholderForm value={form} onChange={setForm} />
    </BillingCadastroPage>
  );
}

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { BriefcaseBusiness } from 'lucide-react';
import { BillingCadastroPage } from '@/components/billing/BillingPrimitives';
import { BillingInternalProviderForm } from '@/components/billing/BillingInternalProviderForm';
import { Button } from '@/components/ui/button';
import {
  fetchCostCenters,
  fetchInternalProvider,
  saveInternalProvider,
  type BillingInternalProvider,
} from '@/lib/billing/billingApi';

export default function BillingPrestadorDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<BillingInternalProvider | null>(null);
  const detailQuery = useQuery({ queryKey: ['billing', 'internal-provider', id], queryFn: () => fetchInternalProvider(id), enabled: !!id });
  const ccQuery = useQuery({ queryKey: ['billing', 'cost-centers', 'active'], queryFn: () => fetchCostCenters(true) });

  useEffect(() => {
    if (detailQuery.data) setForm(detailQuery.data);
  }, [detailQuery.data]);

  const saveMut = useMutation({
    mutationFn: () => saveInternalProvider(form!),
    onSuccess: (row) => setForm(row),
  });

  if (!form) return null;

  return (
    <BillingCadastroPage
      backHref="/billing/cadastros?tab=prestadores"
      backLabel="Voltar para cadastros"
      title={form.legal_name || 'Editar prestador'}
      description="Atualize dados cadastrais, pagamento, vínculo financeiro e centro de custo padrão."
      icon={BriefcaseBusiness}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => router.push('/billing/cadastros?tab=prestadores')}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <BillingInternalProviderForm value={form} onChange={setForm} costCenters={ccQuery.data || []} />
    </BillingCadastroPage>
  );
}

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Users } from 'lucide-react';
import { BillingCadastroPage } from '@/components/billing/BillingPrimitives';
import { BillingShareholderForm } from '@/components/billing/BillingShareholderForm';
import { Button } from '@/components/ui/button';
import { fetchShareholder, saveShareholder, type BillingShareholder } from '@/lib/billing/billingApi';

export default function BillingSocioDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<BillingShareholder | null>(null);
  const detailQuery = useQuery({ queryKey: ['billing', 'shareholder', id], queryFn: () => fetchShareholder(id), enabled: !!id });

  useEffect(() => {
    if (detailQuery.data) setForm(detailQuery.data);
  }, [detailQuery.data]);

  const saveMut = useMutation({
    mutationFn: () => saveShareholder(form!),
    onSuccess: (row) => setForm(row),
  });

  if (!form) return null;

  return (
    <BillingCadastroPage
      backHref="/billing/cadastros?tab=socios"
      backLabel="Voltar para cadastros"
      title={form.legal_name || 'Editar sócio'}
      description="Atualize participação, pró-labore, dados de contato e pagamento do sócio."
      icon={Users}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => router.push('/billing/cadastros?tab=socios')}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <BillingShareholderForm value={form} onChange={setForm} />
    </BillingCadastroPage>
  );
}

'use client';

import { useParams, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Handshake } from 'lucide-react';
import { BillingCadastroPage } from '@/components/billing/BillingPrimitives';
import { BillingCommercialPartnerForm } from '@/components/billing/BillingCommercialPartnerForm';
import { BillingCommissionRulesSection } from '@/components/billing/BillingCommissionRulesSection';
import { Button } from '@/components/ui/button';
import { fetchCommercialPartner, saveCommercialPartner, type BillingCommercialPartner } from '@/lib/billing/billingApi';

export default function BillingParceiroDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [form, setForm] = useState<BillingCommercialPartner | null>(null);
  const detailQuery = useQuery({
    queryKey: ['billing', 'commercial-partner', id],
    queryFn: () => fetchCommercialPartner(id),
    enabled: !!id,
  });

  useEffect(() => {
    if (detailQuery.data) setForm(detailQuery.data);
  }, [detailQuery.data]);

  const saveMut = useMutation({
    mutationFn: () => saveCommercialPartner(form!),
    onSuccess: (row) => setForm(row),
  });

  if (!form) return null;

  return (
    <BillingCadastroPage
      backHref="/billing/cadastros?tab=parceiros"
      backLabel="Voltar para cadastros"
      title={form.legal_name || 'Editar parceiro comercial'}
      description="Atualize cadastro, dados de pagamento e regras de comissão do parceiro comercial."
      icon={Handshake}
      actions={
        <>
          <Button variant="outline" size="sm" onClick={() => router.push('/billing/cadastros?tab=parceiros')}>
            Cancelar
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
            Salvar alterações
          </Button>
        </>
      }
    >
      <BillingCommercialPartnerForm value={form} onChange={setForm} />
      {form.id ? <BillingCommissionRulesSection partnerId={form.id} partner={form} /> : null}
    </BillingCadastroPage>
  );
}

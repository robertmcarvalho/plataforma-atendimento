'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Briefcase } from 'lucide-react';
import { CadastroBackLink } from '@/components/cadastro/CadastroPrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { CommercialLeadForm } from '@/components/commercial/CommercialLeadForm';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import {
  useCommercialOwners,
  useCreateLead,
  useFieldDefinitions,
} from '@/lib/commercial/useCommercialQueries';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import type { LeadInput } from '@/lib/commercial/leadInput';

export function CommercialLeadNewPage() {
  const router = useRouter();
  const createLead = useCreateLead();
  const { data: fieldDefinitions = [], isLoading: fieldsLoading } = useFieldDefinitions();
  const { data: owners = [], isLoading: ownersLoading } = useCommercialOwners();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (input: LeadInput) => {
    setSubmitError(null);
    try {
      const lead = await createLead.mutateAsync(input);
      router.push(`/commercial/leads/${lead.id}`);
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  if (fieldsLoading || ownersLoading) {
    return (
      <div className="mx-auto max-w-6xl">
        <CadastroBackLink href="/commercial/leads">Voltar para leads</CadastroBackLink>
        <PageHeader icon={Briefcase} eyebrow="Comercial" title="Novo lead" description="Carregando..." />
        <CommercialListSkeleton rows={8} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <CadastroBackLink href="/commercial/leads">Voltar para leads</CadastroBackLink>
      <PageHeader
        icon={Briefcase}
        eyebrow="Comercial"
        title="Novo lead"
        description="Prospecção enxuta — CNPJ e telefone obrigatórios."
      />
      <CommercialLeadForm
        mode="create"
        fieldDefinitions={fieldDefinitions}
        owners={owners}
        cancelHref="/commercial/leads"
        onSubmit={handleSubmit}
        submitError={submitError}
        isSubmitting={createLead.isPending}
      />
    </div>
  );
}

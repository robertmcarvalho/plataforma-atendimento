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
  useFieldDefinitions,
  useLead,
  usePatchLead,
} from '@/lib/commercial/useCommercialQueries';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import type { LeadInput } from '@/lib/commercial/leadInput';

type Props = { leadId: string };

export function CommercialLeadEditPage({ leadId }: Props) {
  const router = useRouter();
  const { data: lead, isLoading } = useLead(leadId);
  const { data: fieldDefinitions = [] } = useFieldDefinitions();
  const { data: owners = [] } = useCommercialOwners();
  const patchLead = usePatchLead();
  const [submitError, setSubmitError] = useState<string | null>(null);

  const handleSubmit = async (input: LeadInput) => {
    setSubmitError(null);
    try {
      await patchLead.mutateAsync({ id: leadId, patch: input });
      router.push(`/commercial/leads/${leadId}`);
    } catch (e) {
      setSubmitError(apiErrorMessage(e));
    }
  };

  if (isLoading || !lead) {
    return (
      <div className="mx-auto max-w-6xl">
        <CadastroBackLink href={`/commercial/leads/${leadId}`}>Voltar para ficha do lead</CadastroBackLink>
        <PageHeader icon={Briefcase} eyebrow="Comercial" title="Editar lead" description="Carregando..." />
        <CommercialListSkeleton rows={8} />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl">
      <CadastroBackLink href={`/commercial/leads/${leadId}`}>Voltar para ficha do lead</CadastroBackLink>
      <PageHeader icon={Briefcase} eyebrow="Comercial" title="Editar lead" description={lead.trade_name} />
      <CommercialLeadForm
        mode="edit"
        initial={lead}
        fieldDefinitions={fieldDefinitions}
        owners={owners}
        cancelHref={`/commercial/leads/${leadId}`}
        onSubmit={handleSubmit}
        submitError={submitError}
        isSubmitting={patchLead.isPending}
      />
    </div>
  );
}

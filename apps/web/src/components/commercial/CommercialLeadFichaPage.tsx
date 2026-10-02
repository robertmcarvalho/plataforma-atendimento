'use client';

import { CadastroBackLink } from '@/components/cadastro/CadastroPrimitives';
import { CommercialLeadDetailPanel } from '@/components/commercial/CommercialLeadDetailPanel';
import type { LeadDetailTab } from '@/lib/commercial/commercialStageRules';

export function CommercialLeadFichaPage({
  leadId,
  initialTab,
}: {
  leadId: string;
  initialTab?: LeadDetailTab;
}) {
  return (
    <div className="mx-auto max-w-6xl">
      <CadastroBackLink href="/commercial/leads">Voltar para leads</CadastroBackLink>
      <CommercialLeadDetailPanel leadId={leadId} initialTab={initialTab} variant="ficha" />
    </div>
  );
}

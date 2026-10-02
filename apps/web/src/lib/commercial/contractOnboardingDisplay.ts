import type { ContractOnboarding, ContractOnboardingStatus } from '@/lib/commercial/types';

export function contractOnboardingStatusLabel(status?: ContractOnboardingStatus): string {
  switch (status) {
    case 'awaiting_lead':
      return 'Aguardando lead';
    case 'lead_submitted':
      return 'Aguardando vendedor';
    case 'complete':
      return 'Contrato completo';
    default:
      return 'Não iniciado';
  }
}

export function hasSubmittedContractForm(lead: {
  contract_onboarding?: ContractOnboarding | null;
}): boolean {
  const onboarding = lead.contract_onboarding;
  if (!onboarding) return false;
  return Boolean(
    onboarding.lead_snapshot ||
      onboarding.lead_submitted_at ||
      onboarding.status === 'lead_submitted' ||
      onboarding.status === 'complete',
  );
}

export function contractFormSnapshot(lead: {
  contract_onboarding?: ContractOnboarding | null;
}): Record<string, unknown> | null {
  return (lead.contract_onboarding?.lead_snapshot as Record<string, unknown>) || null;
}

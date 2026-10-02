'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { commercialKeys } from '@/lib/commercial/commercialKeys';
import {
  checkViability,
  checkLeadViability,
  confirmLeadDimensioning,
  selectLeadDimensioningScenario,
  saveLeadPropostaComercial,
  createLeadDataRequest,
  patchLeadContractOnboarding,
  fetchCommercialNotifications,
  markCommercialNotificationRead,
  markAllCommercialNotificationsRead,
  convertLead,
  copilotCommercialChat,
  createLead,
  createProposal,
  regenerateProposal,
  saveProposalNotes,
  fetchCommercialCrmEnabled,
  fetchCommercialProposalsEnabled,
  fetchCommercialDashboard,
  fetchCommercialOwners,
  fetchErpOptions,
  fetchMotorConfig,
  putMotorConfig,
  simulateMotorConfig,
  fetchFieldDefinitions,
  fetchLead,
  fetchLeadActivities,
  fetchLeadConversation,
  fetchLeadScoring,
  fetchLeads,
  fetchLossReasons,
  fetchPipelineStages,
  fetchProposal,
  loseLead,
  patchLead,
  patchLeadStage,
  putFieldDefinitions,
  putErpOptions,
  putLossReasons,
  putPipelineStages,
  sendProposal,
  startLeadConversation,
  type LeadsListParams,
  type ContractOnboardingPatch,
} from '@/lib/commercial/commercialApi';
import type { LeadInput } from '@/lib/commercial/leadInput';
import type { CommercialStage, FieldDefinition, LossReason, PropostaComercialSnapshot } from '@/lib/commercial/types';
import { normalizeDimensionamentoDisplay } from '@/lib/commercial/commercialFinanceDisplay';
import { savePharmacyPrefill } from '@/lib/commercial/pharmacyPrefill';

function invalidateLeadDomain(qc: ReturnType<typeof useQueryClient>, leadId?: string) {
  qc.invalidateQueries({ queryKey: commercialKeys.leads() });
  qc.invalidateQueries({ queryKey: commercialKeys.dashboard() });
  if (leadId) {
    qc.invalidateQueries({ queryKey: commercialKeys.lead(leadId) });
    qc.invalidateQueries({ queryKey: commercialKeys.activities(leadId) });
    qc.invalidateQueries({ queryKey: commercialKeys.conversation(leadId) });
    qc.invalidateQueries({ queryKey: commercialKeys.scoring(leadId) });
  }
}

export function useCommercialCrmEnabled() {
  return useQuery({
    queryKey: commercialKeys.crmEnabled(),
    queryFn: fetchCommercialCrmEnabled,
    staleTime: 30_000,
  });
}

export function useCommercialProposalsEnabled() {
  return useQuery({
    queryKey: commercialKeys.proposalsEnabled(),
    queryFn: fetchCommercialProposalsEnabled,
    staleTime: 30_000,
  });
}

export function usePipelineStages() {
  return useQuery({
    queryKey: commercialKeys.stages(),
    queryFn: fetchPipelineStages,
    staleTime: 60_000,
  });
}

export function useCommercialOwners() {
  return useQuery({
    queryKey: commercialKeys.owners(),
    queryFn: fetchCommercialOwners,
    staleTime: 120_000,
  });
}

export function useLeads(params: LeadsListParams = {}, options?: { pollScoring?: boolean }) {
  return useQuery({
    queryKey: commercialKeys.leads(params),
    queryFn: () => fetchLeads(params),
    staleTime: 15_000,
    refetchInterval: (query) => {
      if (!options?.pollScoring) return false;
      const leads = query.state.data?.data ?? [];
      const hasPendingScoring = leads.some((lead) => !lead.ai_score_set_at);
      return hasPendingScoring ? 5000 : false;
    },
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: commercialKeys.lead(id || ''),
    queryFn: () => fetchLead(id!),
    enabled: Boolean(id),
  });
}

export function useLeadActivities(leadId: string | undefined) {
  return useQuery({
    queryKey: commercialKeys.activities(leadId || ''),
    queryFn: () => fetchLeadActivities(leadId!),
    enabled: Boolean(leadId),
  });
}

export function useLeadConversation(leadId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: commercialKeys.conversation(leadId || ''),
    queryFn: () => fetchLeadConversation(leadId!),
    enabled: Boolean(leadId) && enabled,
  });
}

export function useLeadScoring(leadId: string | undefined, pollWhilePending = false) {
  return useQuery({
    queryKey: commercialKeys.scoring(leadId || ''),
    queryFn: () => fetchLeadScoring(leadId!),
    enabled: Boolean(leadId),
    refetchInterval: (query) => {
      if (!pollWhilePending) return false;
      const data = query.state.data;
      if (data && !data.is_pending) return false;
      return 3000;
    },
  });
}

export function useFieldDefinitions() {
  return useQuery({
    queryKey: commercialKeys.fieldDefinitions(),
    queryFn: fetchFieldDefinitions,
    staleTime: 60_000,
  });
}

export function useLossReasons() {
  return useQuery({
    queryKey: commercialKeys.lossReasons(),
    queryFn: fetchLossReasons,
    staleTime: 60_000,
  });
}

export function useErpOptions() {
  return useQuery({
    queryKey: commercialKeys.erpOptions(),
    queryFn: fetchErpOptions,
    staleTime: 60_000,
  });
}

export function useProposal(id: string | undefined) {
  return useQuery({
    queryKey: commercialKeys.proposal(id || ''),
    queryFn: () => fetchProposal(id!),
    enabled: Boolean(id),
  });
}

export function useCommercialDashboard(params?: { owner_id?: string; source?: string }) {
  return useQuery({
    queryKey: commercialKeys.dashboard(params),
    queryFn: () => fetchCommercialDashboard(params),
    staleTime: 30_000,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: LeadInput) => createLead(input),
    onSuccess: () => invalidateLeadDomain(qc),
  });
}

export function usePatchLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<LeadInput> & { stage_id?: string; loss_reason_id?: string | null } }) =>
      patchLead(id, patch),
    onSuccess: (_d, v) => invalidateLeadDomain(qc, v.id),
  });
}

export function useMoveLeadStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, stage_id, loss_reason_id }: { id: string; stage_id: string; loss_reason_id?: string }) =>
      patchLeadStage(id, stage_id, loss_reason_id ? { loss_reason_id } : undefined),
    onSuccess: (_d, v) => invalidateLeadDomain(qc, v.id),
  });
}

export function useLoseLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, loss_reason_id, notes }: { id: string; loss_reason_id: string; notes?: string }) =>
      loseLead(id, loss_reason_id, notes),
    onSuccess: (_d, v) => invalidateLeadDomain(qc, v.id),
  });
}

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => convertLead(id),
    onSuccess: (data, id) => {
      if (data.prefill) savePharmacyPrefill(data.prefill);
      invalidateLeadDomain(qc, id);
    },
  });
}

export function useStartLeadConversation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => startLeadConversation(leadId),
    onSuccess: (_d, leadId) => {
      invalidateLeadDomain(qc, leadId);
      qc.invalidateQueries({ queryKey: commercialKeys.conversation(leadId) });
    },
  });
}

export function useConfirmLeadDimensioning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => confirmLeadDimensioning(leadId),
    onSuccess: (data, leadId) => {
      const snap = normalizeDimensionamentoDisplay(data.operational_snapshot);
      qc.setQueryData(commercialKeys.lead(leadId), (old: import('@/lib/commercial/types').CommercialLead | undefined) => {
        if (!old) return old;
        return {
          ...old,
          operational_snapshot: snap,
          dimensionamento_confirmed: true,
          deal_value_cents: snap.valor_lead_anual_cents,
          drivers_count: snap.quantidade_entregadores_recomendada,
        };
      });
      invalidateLeadDomain(qc, leadId);
    },
  });
}

export function useSelectLeadDimensioningScenario() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      leadId,
      cenarioId,
    }: {
      leadId: string;
      cenarioId: 'enxuto' | 'enxuto_domingo' | 'integral';
    }) => selectLeadDimensioningScenario(leadId, cenarioId),
    onSuccess: (data, { leadId }) => {
      const snap = normalizeDimensionamentoDisplay(data.operational_snapshot);
      qc.setQueryData(commercialKeys.lead(leadId), (old: import('@/lib/commercial/types').CommercialLead | undefined) => {
        if (!old) return old;
        return {
          ...old,
          operational_snapshot: snap,
          deal_value_cents: snap.valor_lead_anual_cents,
          drivers_count: snap.quantidade_entregadores_recomendada,
        };
      });
    },
  });
}

export function useSaveLeadPropostaComercial() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, payload }: { leadId: string; payload: Partial<PropostaComercialSnapshot> }) =>
      saveLeadPropostaComercial(leadId, payload),
    onSuccess: (data, { leadId }) => {
      const snap = normalizeDimensionamentoDisplay(data.operational_snapshot);
      qc.setQueryData(commercialKeys.lead(leadId), (old: import('@/lib/commercial/types').CommercialLead | undefined) => {
        if (!old) return old;
        return {
          ...old,
          operational_snapshot: snap,
          deal_value_cents: snap.valor_lead_anual_cents,
          drivers_count: snap.quantidade_entregadores_recomendada,
        };
      });
      invalidateLeadDomain(qc, leadId);
    },
  });
}

export function useCheckLeadViability() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => checkLeadViability(leadId),
    onSuccess: (data, leadId) => {
      if (data.dimensionamento) {
        qc.setQueryData(commercialKeys.lead(leadId), (old: import('@/lib/commercial/types').CommercialLead | undefined) => {
          if (!old) return old;
          return {
            ...old,
            operational_snapshot: data.dimensionamento,
            deal_value_cents: data.valor_lead_anual_cents ?? data.dimensionamento?.valor_lead_anual_cents,
            drivers_count: data.dimensionamento?.quantidade_entregadores_recomendada,
          };
        });
      }
      invalidateLeadDomain(qc, leadId);
    },
  });
}

export function useCheckViability() {
  return useMutation({
    mutationFn: ({ city, state, volume }: { city: string; state: string; volume: number }) =>
      checkViability(city, state, volume),
  });
}

export function useCreateLeadDataRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (leadId: string) => createLeadDataRequest(leadId),
    onSuccess: (_data, leadId) => {
      invalidateLeadDomain(qc, leadId);
    },
  });
}

export function useCommercialNotifications() {
  return useQuery({
    queryKey: commercialKeys.notifications(),
    queryFn: () => fetchCommercialNotifications(),
    refetchInterval: 60_000,
  });
}

export function usePatchLeadContractOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ leadId, body }: { leadId: string; body: ContractOnboardingPatch }) =>
      patchLeadContractOnboarding(leadId, body),
    onSuccess: (lead) => {
      qc.setQueryData(commercialKeys.lead(lead.id), lead);
      invalidateLeadDomain(qc, lead.id);
    },
  });
}

export function useMarkCommercialNotificationRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => markCommercialNotificationRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commercialKeys.notifications() });
    },
  });
}

export function useMarkAllCommercialNotificationsRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => markAllCommercialNotificationsRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commercialKeys.notifications() });
    },
  });
}

export function useCreateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProposal,
    onSuccess: (_d, vars) => invalidateLeadDomain(qc, vars.lead_id),
  });
}

export function useSendProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: sendProposal,
    onSuccess: (proposal) => {
      qc.invalidateQueries({ queryKey: commercialKeys.proposal(proposal.id) });
      invalidateLeadDomain(qc, proposal.lead_id);
    },
  });
}

export function useRegenerateProposal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (proposalId: string) => regenerateProposal(proposalId),
    onSuccess: (proposal) => {
      qc.setQueryData(commercialKeys.proposal(proposal.id), proposal);
      invalidateLeadDomain(qc, proposal.lead_id);
    },
  });
}

export function useSaveProposalNotes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ proposalId, notes }: { proposalId: string; notes: string | null }) =>
      saveProposalNotes(proposalId, notes),
    onSuccess: (proposal) => {
      qc.setQueryData(commercialKeys.proposal(proposal.id), proposal);
    },
  });
}

export function usePutPipelineStages() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (stages: CommercialStage[]) => putPipelineStages(stages),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: commercialKeys.stages() });
      qc.invalidateQueries({ queryKey: commercialKeys.leads() });
    },
  });
}

export function usePutFieldDefinitions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fields: FieldDefinition[]) => putFieldDefinitions(fields),
    onSuccess: () => qc.invalidateQueries({ queryKey: commercialKeys.fieldDefinitions() }),
  });
}

export function usePutLossReasons() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (reasons: LossReason[]) => putLossReasons(reasons),
    onSuccess: () => qc.invalidateQueries({ queryKey: commercialKeys.lossReasons() }),
  });
}

export function usePutErpOptions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (options: import('@/lib/commercial/types').CommercialErpOption[]) => putErpOptions(options),
    onSuccess: () => qc.invalidateQueries({ queryKey: commercialKeys.erpOptions() }),
  });
}

export function useCopilotCommercialChat() {
  return useMutation({
    mutationFn: ({ commercial_lead_id, message }: { commercial_lead_id: string; message: string }) =>
      copilotCommercialChat(commercial_lead_id, message),
  });
}

export function useMotorConfig() {
  return useQuery({
    queryKey: commercialKeys.motorConfig(),
    queryFn: fetchMotorConfig,
    staleTime: 60_000,
  });
}

export function usePutMotorConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: putMotorConfig,
    onSuccess: () => qc.invalidateQueries({ queryKey: commercialKeys.motorConfig() }),
  });
}

export function useSimulateMotorConfig() {
  return useMutation({
    mutationFn: simulateMotorConfig,
  });
}

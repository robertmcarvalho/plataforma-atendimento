import axios from 'axios';
import api, { resolveApiBaseUrl } from '@/lib/api';
import { commercialDebugError, commercialDebugLog } from '@/lib/commercial/commercialDebugLog';
import type {
  CommercialActivity,
  CommercialErpOption,
  CommercialLead,
  CommercialProposal,
  CommercialStage,
  FieldDefinition,
  LossReason,
  OperationalDimensioningResult,
  PropostaComercialSnapshot,
  ViabilityResult,
} from '@/lib/commercial/types';
import type { LeadInput } from '@/lib/commercial/leadInput';
import { toApiLeadBody, toApiLeadPatch } from '@/lib/commercial/leadInput';
import type { CommercialPharmacyPrefill } from '@/lib/commercial/pharmacyPrefill';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function persistedId(id?: string): { id: string } | Record<string, never> {
  return id && UUID_RE.test(id) ? { id } : {};
}

export type LeadsListParams = {
  q?: string;
  stage_id?: string;
  owner_id?: string;
  source?: string;
  temperature?: string;
  page?: number;
  limit?: number;
};

export type LeadsListResponse = {
  data: CommercialLead[];
  total: number;
  page: number;
  limit: number;
};

export type CommercialDashboardResponse = {
  total_leads: number;
  by_stage: Array<{ stage_id: string; stage_name: string; count: number }>;
  won_count: number;
  lost_count: number;
  weighted_pipeline_cents: number;
  stagnant_count: number;
};

export type LeadScoringResponse = {
  status: 'ready' | 'pending';
  is_pending: boolean;
  ai_score: number | null;
  lead_temperature: 'frio' | 'morno' | 'quente' | 'urgente' | null;
  explanation: string | null;
  stagnant_days: number;
  is_stagnant: boolean;
};

export type ConversationMessageRow = {
  id: string;
  direction: 'inbound' | 'outbound';
  content: string | null;
  created_at: string;
  status?: string;
  type?: string;
};

export type LeadConversationResponse = {
  conversation: Record<string, unknown> | null;
  messages: ConversationMessageRow[];
};

export type ConvertLeadResponse = {
  pharmacy_id: string;
  lead: CommercialLead;
  prefill: CommercialPharmacyPrefill;
};

function normalizeStage(row: CommercialStage & { probability_pct?: number }): CommercialStage {
  return {
    ...row,
    probability: row.probability ?? row.probability_pct ?? 0,
  };
}

function parseWorkspaceBooleanSetting(v: unknown, defaultValue: boolean): boolean {
  if (v === null || v === undefined) return defaultValue;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v !== '0' && v !== 'false';
  return Boolean(v);
}

export async function fetchCommercialCrmEnabled(): Promise<boolean> {
  const { data } = await api.get<Record<string, unknown>>('/api/settings');
  return parseWorkspaceBooleanSetting(data?.commercial_crm_enabled, false);
}

export async function fetchCommercialProposalsEnabled(): Promise<boolean> {
  const { data } = await api.get<Record<string, unknown>>('/api/settings');
  return parseWorkspaceBooleanSetting(data?.commercial_proposals_enabled, false);
}

export async function fetchPipelineStages(): Promise<CommercialStage[]> {
  const { data } = await api.get<CommercialStage[]>('/api/commercial/pipeline-stages');
  return (data || []).map((s) => normalizeStage(s as CommercialStage & { probability_pct?: number }));
}

export async function putPipelineStages(stages: CommercialStage[]): Promise<CommercialStage[]> {
  const body = stages.map((s) => ({
    ...(UUID_RE.test(s.id) ? { id: s.id } : {}),
    name: s.name,
    sort_order: s.sort_order,
    color: s.color,
    probability_pct: s.probability,
    is_won: s.is_won,
    is_lost: s.is_lost,
    is_entry: s.is_entry,
  }));
  const { data } = await api.put<CommercialStage[]>('/api/commercial/pipeline-stages', body);
  return (data || []).map((s) => normalizeStage(s as CommercialStage & { probability_pct?: number }));
}

export async function fetchLeads(params: LeadsListParams = {}): Promise<LeadsListResponse> {
  const { data } = await api.get<LeadsListResponse>('/api/commercial/leads', {
    params: { limit: 500, ...params },
  });
  return {
    ...data,
    data: (data.data || []).map((l) => ({
      ...l,
      commercial_conversation_id:
        l.commercial_conversation_id ??
        (l as CommercialLead & { primary_conversation_id?: string }).primary_conversation_id,
    })),
  };
}

export async function fetchLead(id: string): Promise<CommercialLead> {
  const { data } = await api.get<CommercialLead>(`/api/commercial/leads/${id}`);
  return {
    ...data,
    commercial_conversation_id:
      data.commercial_conversation_id ??
      (data as CommercialLead & { primary_conversation_id?: string }).primary_conversation_id,
  };
}

export async function createLead(input: LeadInput): Promise<CommercialLead> {
  const { data } = await api.post<CommercialLead>('/api/commercial/leads', toApiLeadBody(input));
  return data;
}

export async function patchLead(
  id: string,
  patch: Partial<LeadInput> & { stage_id?: string; loss_reason_id?: string | null },
): Promise<CommercialLead> {
  const { data } = await api.patch<CommercialLead>(`/api/commercial/leads/${id}`, toApiLeadPatch(patch));
  return data;
}

export async function patchLeadStage(id: string, stage_id: string, extra?: { loss_reason_id?: string }) {
  const { data } = await api.patch<CommercialLead>(`/api/commercial/leads/${id}`, { stage_id, ...extra });
  return data;
}

export async function loseLead(id: string, loss_reason_id: string, notes?: string): Promise<CommercialLead> {
  const { data } = await api.post<CommercialLead>(`/api/commercial/leads/${id}/lose`, {
    loss_reason_id,
    notes: notes ?? null,
  });
  return data;
}

export async function convertLead(id: string): Promise<ConvertLeadResponse> {
  const { data } = await api.post<ConvertLeadResponse>(`/api/commercial/leads/${id}/convert`);
  return data;
}

export async function fetchLeadActivities(leadId: string): Promise<CommercialActivity[]> {
  const { data } = await api.get<CommercialActivity[]>(`/api/commercial/leads/${leadId}/activities`);
  return data || [];
}

export async function startLeadConversation(leadId: string): Promise<{ conversation_id: string }> {
  const { data } = await api.post<{ conversation_id: string }>(
    `/api/commercial/leads/${leadId}/conversation/start`,
    {},
  );
  return data;
}

export async function startCommercialLeadProspeccao(payload: {
  commercial_lead_id: string;
  template_id: string;
  template_variables: Record<string, string>;
}): Promise<{ id: string }> {
  const { data } = await api.post<{ id: string }>('/api/conversations/start', {
    contact_type: 'commercial_lead',
    commercial_lead_id: payload.commercial_lead_id,
    initial_message: {
      template_id: payload.template_id,
      template_variables: payload.template_variables,
    },
  });
  return data;
}

export async function fetchLeadConversation(leadId: string): Promise<LeadConversationResponse> {
  const { data } = await api.get<LeadConversationResponse>(`/api/commercial/leads/${leadId}/conversation`);
  return data ?? { conversation: null, messages: [] };
}

export async function fetchLeadScoring(leadId: string): Promise<LeadScoringResponse> {
  const { data } = await api.get<LeadScoringResponse>(`/api/commercial/leads/${leadId}/scoring`);
  return data;
}

export async function refreshLeadScoring(leadId: string): Promise<{ ok: boolean; status: string }> {
  const { data } = await api.post<{ ok: boolean; status: string }>(
    `/api/commercial/leads/${leadId}/scoring/refresh`,
    {},
  );
  return data;
}

export async function fetchFieldDefinitions(): Promise<FieldDefinition[]> {
  const { data } = await api.get<FieldDefinition[]>('/api/commercial/field-definitions');
  return data || [];
}

export async function putFieldDefinitions(fields: FieldDefinition[]): Promise<FieldDefinition[]> {
  const body = fields.map((f) => ({
    ...persistedId(f.id),
    slug: f.slug,
    label: f.label,
    type: f.type,
    required: f.required,
    options: f.options ?? [],
    sort_order: f.sort_order,
  }));
  const { data } = await api.put<FieldDefinition[]>('/api/commercial/field-definitions', body);
  return data || [];
}

export async function fetchLossReasons(): Promise<LossReason[]> {
  const { data } = await api.get<LossReason[]>('/api/commercial/loss-reasons');
  return data || [];
}

export async function putLossReasons(reasons: LossReason[]): Promise<LossReason[]> {
  const body = reasons.map((r, i) => ({
    ...persistedId(r.id),
    name: r.name,
    active: r.active,
    sort_order: i,
  }));
  const { data } = await api.put<LossReason[]>('/api/commercial/loss-reasons', body);
  return data || [];
}

export async function fetchErpOptions(): Promise<CommercialErpOption[]> {
  const { data } = await api.get<CommercialErpOption[]>('/api/commercial/erp-options');
  return data || [];
}

export async function putErpOptions(options: CommercialErpOption[]): Promise<CommercialErpOption[]> {
  const body = options.map((o, i) => ({
    ...persistedId(o.id),
    name: o.name,
    active: o.active,
    sort_order: i,
  }));
  const { data } = await api.put<CommercialErpOption[]>('/api/commercial/erp-options', body);
  return data || [];
}

export async function saveLeadPropostaComercial(
  leadId: string,
  payload: Partial<PropostaComercialSnapshot>,
): Promise<{ operational_snapshot: OperationalDimensioningResult }> {
  const { data } = await api.post<{ operational_snapshot: OperationalDimensioningResult }>(
    `/api/commercial/leads/${leadId}/dimensioning/commercial`,
    payload,
  );
  return data;
}

export async function createProposal(payload: {
  lead_id: string;
  package_name?: string;
  setup_cents?: number;
  setup_pagamento?: 'a_vista' | 'parcelado';
  setup_parcelas?: number | null;
  monthly_cents?: number;
  mdr_pct?: number;
  notes?: string;
}): Promise<CommercialProposal> {
  const { data } = await api.post<CommercialProposal>('/api/commercial/proposals', payload);
  return data;
}

export async function fetchProposal(id: string): Promise<CommercialProposal> {
  const { data } = await api.get<CommercialProposal>(`/api/commercial/proposals/${id}`);
  return data;
}

export async function sendProposal(id: string): Promise<CommercialProposal> {
  const { data } = await api.post<CommercialProposal>(`/api/commercial/proposals/${id}/send`, {});
  return data;
}

export async function checkLeadViability(leadId: string): Promise<ViabilityResult> {
  const { data } = await api.post<ViabilityResult>(`/api/commercial/leads/${leadId}/viability`, {});
  return data;
}

export async function confirmLeadDimensioning(
  leadId: string,
): Promise<{ confirmed: boolean; operational_snapshot: OperationalDimensioningResult }> {
  const { data } = await api.post<{ confirmed: boolean; operational_snapshot: OperationalDimensioningResult }>(
    `/api/commercial/leads/${leadId}/dimensioning/confirm`,
    {},
  );
  return data;
}

export async function selectLeadDimensioningScenario(
  leadId: string,
  cenarioId: 'enxuto' | 'enxuto_domingo' | 'integral',
): Promise<{ operational_snapshot: OperationalDimensioningResult }> {
  const url = `/api/commercial/leads/${leadId}/dimensioning/select`;
  const baseURL = resolveApiBaseUrl();
  const fullUrl = `${baseURL}${url}`;
  commercialDebugLog('api:select', { fullUrl, url, leadId, cenarioId, baseURL });
  try {
    const { data } = await api.post<{ operational_snapshot: OperationalDimensioningResult }>(url, {
      cenario_id: cenarioId,
    });
    return data;
  } catch (err) {
    commercialDebugError(
      'api:select',
      {
        fullUrl,
        url,
        leadId,
        cenarioId,
        baseURL,
        status: axios.isAxiosError(err) ? err.response?.status : undefined,
        body: axios.isAxiosError(err) ? err.response?.data : undefined,
      },
      err,
    );
    throw err;
  }
}

export function proposalPdfDownloadUrl(proposalId: string): string {
  const base = resolveApiBaseUrl();
  return `${base}/api/commercial/proposals/${proposalId}/pdf`;
}

export function proposalDocxUrl(proposalId: string): string {
  const base = resolveApiBaseUrl();
  return `${base}/api/commercial/proposals/${proposalId}/docx`;
}

export async function fetchProposalPdfBlob(
  proposalId: string,
  inline = false,
): Promise<{ blob: Blob; filename: string }> {
  const url = `/api/commercial/proposals/${proposalId}/pdf`;
  const res = await api.get(url, {
    responseType: 'blob',
    params: inline ? { disposition: 'inline' } : undefined,
  });
  const blob = res.data as Blob;
  const disposition = res.headers['content-disposition'] as string | undefined;
  let filename = 'proposta.pdf';
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  if (match?.[1]) filename = match[1];
  return { blob, filename };
}

export async function downloadProposalPdf(proposalId: string): Promise<void> {
  const { blob, filename } = await fetchProposalPdfBlob(proposalId, false);
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export async function regenerateProposal(proposalId: string): Promise<CommercialProposal> {
  const { data } = await api.post<CommercialProposal>(
    `/api/commercial/proposals/${proposalId}/regenerate`,
    {},
  );
  return data;
}

export async function saveProposalNotes(
  proposalId: string,
  notes: string | null,
): Promise<CommercialProposal> {
  const { data } = await api.put<CommercialProposal>(`/api/commercial/proposals/${proposalId}/notes`, {
    notes,
  });
  return data;
}

export async function downloadProposalDocx(proposalId: string): Promise<void> {
  const res = await api.get(`/api/commercial/proposals/${proposalId}/docx`, { responseType: 'blob' });
  const blob = res.data as Blob;
  const disposition = res.headers['content-disposition'] as string | undefined;
  let filename = 'proposta.docx';
  const match = disposition?.match(/filename="?([^"]+)"?/i);
  if (match?.[1]) filename = match[1];
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

export async function checkViability(city: string, state: string, volume: number): Promise<ViabilityResult> {
  const { data } = await api.post<ViabilityResult>('/api/commercial/viability/check', { city, state, volume });
  return data;
}

export type DataRequestResponse = {
  data_request_id: string;
  url: string;
  expires_at: string;
  token: string;
};

export async function createLeadDataRequest(leadId: string): Promise<DataRequestResponse> {
  const { data } = await api.post<DataRequestResponse>(`/api/commercial/leads/${leadId}/data-request`, {});
  return data;
}

export type ContractOnboardingPatch = {
  legal_name?: string;
  trade_name?: string;
  delivery_fee_cents?: number | null;
  delivery_fee_driver_payout_cents?: number | null;
  minimum_guaranteed_cents?: number | null;
  minimum_guaranteed_driver_payout_cents?: number | null;
  setup_cents?: number | null;
  setup_parcelado?: boolean;
  setup_parcelas?: number | null;
  drivers_count?: number | null;
  delivery_schedule?: Record<string, unknown>;
  pickup_address_cep?: string;
  pickup_address_street?: string;
  pickup_address_number?: string;
  pickup_address_neighborhood?: string;
  pickup_address_complement?: string;
  pickup_city?: string;
  pickup_state?: string;
};

export async function patchLeadContractOnboarding(
  leadId: string,
  body: ContractOnboardingPatch,
): Promise<CommercialLead> {
  const { data } = await api.patch<CommercialLead>(`/api/commercial/leads/${leadId}/contract-onboarding`, body);
  return data;
}

export type CommercialNotificationsResponse = {
  data: import('@/lib/commercial/types').CommercialNotification[];
  unread_count: number;
};

export async function fetchCommercialNotifications(limit = 30): Promise<CommercialNotificationsResponse> {
  const { data } = await api.get<CommercialNotificationsResponse>('/api/commercial/notifications', {
    params: { limit },
  });
  return data;
}

export async function markCommercialNotificationRead(id: string): Promise<void> {
  await api.patch(`/api/commercial/notifications/${id}/read`);
}

export async function markAllCommercialNotificationsRead(): Promise<void> {
  await api.patch('/api/commercial/notifications/mark-all-read');
}

export async function fetchCommercialDashboard(params?: {
  owner_id?: string;
  source?: string;
}): Promise<CommercialDashboardResponse> {
  const { data } = await api.get<CommercialDashboardResponse>('/api/commercial/dashboard', { params });
  return data;
}

export async function copilotCommercialChat(commercial_lead_id: string, message: string): Promise<{ reply: string }> {
  const { data } = await api.post<{ reply: string }>('/api/copilot/chat', { commercial_lead_id, message });
  return data;
}

export type CommercialOwner = { id: string; name: string };

export async function fetchCommercialOwners(): Promise<CommercialOwner[]> {
  const { data } = await api.get<CommercialOwner[]>('/api/commercial/owners');
  return data || [];
}

export async function fetchMotorConfig(): Promise<import('@/lib/commercial/commercialMotorTypes').MotorConfigResponse> {
  const { data } = await api.get('/api/commercial/motor-config');
  return data;
}

export async function putMotorConfig(
  patch: Partial<import('@/lib/commercial/commercialMotorTypes').CommercialMotorConfig>,
): Promise<import('@/lib/commercial/commercialMotorTypes').CommercialMotorConfig> {
  const { data } = await api.put<{ config: import('@/lib/commercial/commercialMotorTypes').CommercialMotorConfig }>(
    '/api/commercial/motor-config',
    patch,
  );
  return data.config;
}

export async function simulateMotorConfig(
  body: import('@/lib/commercial/commercialMotorTypes').MotorSimulateRequest,
): Promise<import('@/lib/commercial/commercialMotorTypes').MotorSimulateResponse> {
  const { data } = await api.post('/api/commercial/motor-config/simulate', body);
  return data;
}

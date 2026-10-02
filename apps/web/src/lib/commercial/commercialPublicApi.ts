import api from '@/lib/api';
import type { ContractChecklist } from '@/lib/commercial/types';

export type ApiState = { code: string; name: string };
export type ApiCity = { name: string };

export type PublicDataRequestMeta = {
  status: string;
  expires_at: string;
  required_fields: string[];
  lead: {
    trade_name: string;
    legal_name?: string;
    city: string;
    state: string;
    contact_name: string;
  };
  contract_checklist: ContractChecklist;
  contract_onboarding_status?: string;
  current: Record<string, string | null | undefined>;
};

export type PublicDataRequestSubmit = {
  legal_representative_name: string;
  legal_representative_cpf: string;
  legal_representative_email: string;
  legal_representative_phone: string;
  cnpj: string;
  address_cep: string;
  address_street: string;
  address_number: string;
  address_neighborhood: string;
  address_complement?: string;
  city: string;
  state: string;
  contact_expedition_name: string;
  contact_expedition_phone: string;
  contact_financial_name: string;
  contact_financial_phone: string;
};

export async function fetchPublicCommercialStates(): Promise<ApiState[]> {
  const { data } = await api.get<ApiState[]>('/api/public/commercial/geo/states');
  return data || [];
}

export async function fetchPublicCommercialCities(uf: string): Promise<ApiCity[]> {
  const { data } = await api.get<ApiCity[]>(`/api/public/commercial/geo/states/${encodeURIComponent(uf)}/cities`);
  return data || [];
}

export async function fetchPublicCep(cep: string) {
  const { data } = await api.get<{
    not_found?: boolean;
    street?: string;
    neighborhood?: string;
    city?: string;
    state?: string;
  }>(`/api/public/commercial/geo/cep/${encodeURIComponent(cep)}`);
  return data;
}

export async function fetchPublicDataRequest(token: string): Promise<PublicDataRequestMeta> {
  const { data } = await api.get<PublicDataRequestMeta>(`/api/public/commercial/data-request/${encodeURIComponent(token)}`);
  return data;
}

export async function submitPublicDataRequest(token: string, body: PublicDataRequestSubmit) {
  const { data } = await api.put(`/api/public/commercial/data-request/${encodeURIComponent(token)}`, body);
  return data;
}

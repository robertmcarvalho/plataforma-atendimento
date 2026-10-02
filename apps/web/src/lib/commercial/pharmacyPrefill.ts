import type { CommercialLead, FieldDefinition } from '@/lib/commercial/types';
import { formatCnpj, formatBrazilPhone } from '@/lib/brFormat';

export type CommercialPharmacyPrefill = {
  pharmacy_id: string;
  lead_id: string;
  trade_name: string;
  legal_name: string;
  cnpj: string;
  phone: string;
  city: string;
  state: string;
  contact_expedition_name: string;
  contact_expedition_phone: string;
  contact_expedition_email: string;
  contact_manager_name: string;
  contact_manager_phone: string;
  contact_manager_email: string;
  notes: string;
  erp: string;
  estimated_monthly_deliveries: string;
  estimated_drivers: string;
  custom_fields_summary: string;
};

const STORAGE_KEY = 'commercial_pharmacy_prefill_v1';

export function mapLeadToPharmacyPrefill(
  lead: CommercialLead,
  pharmacyId: string,
  fieldDefinitions: FieldDefinition[],
): CommercialPharmacyPrefill {
  const customSummary = fieldDefinitions
    .map((f) => {
      const v = lead.custom_fields?.[f.slug];
      if (v === undefined || v === '') return null;
      return `${f.label}: ${String(v)}`;
    })
    .filter(Boolean)
    .join(' · ');

  return {
    pharmacy_id: pharmacyId,
    lead_id: lead.id,
    trade_name: lead.trade_name,
    legal_name: lead.legal_name || lead.trade_name,
    cnpj: lead.cnpj || '',
    phone: lead.phone,
    city: lead.city,
    state: lead.state,
    contact_expedition_name: lead.contact_expedition_name || lead.contact_name,
    contact_expedition_phone: lead.contact_expedition_phone || lead.phone,
    contact_expedition_email: lead.contact_email || '',
    contact_manager_name: lead.legal_representative_name || lead.contact_name,
    contact_manager_phone: lead.legal_representative_phone || lead.phone,
    contact_manager_email: lead.legal_representative_email || lead.contact_email || '',
    notes: [lead.notes, lead.campaign ? `Campanha: ${lead.campaign}` : ''].filter(Boolean).join('\n'),
    erp: lead.erp || '',
    estimated_monthly_deliveries: lead.monthly_deliveries?.toString() || '',
    estimated_drivers: lead.drivers_count?.toString() || '',
    custom_fields_summary: customSummary,
  };
}

export function savePharmacyPrefill(prefill: CommercialPharmacyPrefill) {
  if (typeof window === 'undefined') return;
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(prefill));
}

export function readPharmacyPrefill(): CommercialPharmacyPrefill | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CommercialPharmacyPrefill;
  } catch {
    return null;
  }
}

export function clearPharmacyPrefill() {
  if (typeof window === 'undefined') return;
  sessionStorage.removeItem(STORAGE_KEY);
}

export function prefillDisplayRows(prefill: CommercialPharmacyPrefill) {
  return [
    { label: 'Nome fantasia', value: prefill.trade_name },
    { label: 'Razão social', value: prefill.legal_name },
    { label: 'CNPJ', value: prefill.cnpj ? formatCnpj(prefill.cnpj) : '—' },
    { label: 'Telefone', value: formatBrazilPhone(prefill.phone) },
    { label: 'Cidade / UF', value: `${prefill.city}/${prefill.state}` },
    { label: 'Contato expedição', value: prefill.contact_expedition_name },
    { label: 'E-mail expedição', value: prefill.contact_expedition_email || '—' },
    { label: 'Gestor', value: prefill.contact_manager_name },
    { label: 'ERP', value: prefill.erp || '—' },
    { label: 'Entregas/mês (est.)', value: prefill.estimated_monthly_deliveries || '—' },
    { label: 'Entregadores (est.)', value: prefill.estimated_drivers || '—' },
    { label: 'Campos custom', value: prefill.custom_fields_summary || '—' },
    { label: 'Notas comerciais', value: prefill.notes || '—' },
  ];
}

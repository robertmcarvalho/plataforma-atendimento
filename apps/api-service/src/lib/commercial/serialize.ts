export function mapStageRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    sort_order: row.sort_order,
    probability: row.probability_pct,
    probability_pct: row.probability_pct,
    is_won: row.is_won,
    is_lost: row.is_lost,
    is_entry: row.is_entry,
  };
}

import { contractChecklistFromLead } from './contractFields';
import {
  parseContractOnboarding,
  resolveContractOnboardingStatus,
  sellerContractChecklist,
} from './contractOnboarding';
import { rehydrateOperationalSnapshot } from './commercialSnapshotFinance';
import { isDimensionamentoConfirmed } from './enhancedViability';
import type { DimensionamentoResultado } from './operationalDimensioning';

export function mapLeadRow(row: Record<string, unknown>) {
  const checklist = contractChecklistFromLead(row);
  const onboarding = parseContractOnboarding(row.contract_onboarding);
  const status = resolveContractOnboardingStatus(onboarding, row);
  const sellerChecklist = sellerContractChecklist(onboarding.seller, row);
  const snapshot = row.operational_snapshot;
  const snapshotObj =
    snapshot && typeof snapshot === 'object' ? (snapshot as Record<string, unknown>) : null;
  const hydrated =
    snapshotObj?.perfil_operacao
      ? rehydrateOperationalSnapshot(snapshotObj as unknown as DimensionamentoResultado)
      : null;
  return {
    ...row,
    commercial_conversation_id: row.primary_conversation_id ?? null,
    contract_checklist: checklist,
    contract_onboarding: { ...onboarding, status },
    seller_contract_checklist: sellerChecklist,
    contract_onboarding_complete: status === 'complete',
    operational_snapshot: hydrated,
    dimensionamento_confirmed: isDimensionamentoConfirmed(snapshot),
    deal_value_cents: hydrated?.valor_lead_anual_cents ?? row.deal_value_cents,
    drivers_count: hydrated?.quantidade_entregadores_recomendada ?? row.drivers_count,
  };
}

export function mapFieldDefinitionRow(row: Record<string, unknown>) {
  const opts = row.options;
  return {
    id: row.id,
    slug: row.slug,
    label: row.label,
    type: row.field_type,
    required: row.required,
    options: Array.isArray(opts) ? opts : [],
    sort_order: row.sort_order,
  };
}

export function mapActivityRow(row: Record<string, unknown>) {
  return {
    id: row.id,
    lead_id: row.lead_id,
    type: row.activity_type,
    title: row.title,
    detail: row.detail,
    created_at: row.created_at,
  };
}

export function mapProposalRow(row: Record<string, unknown>) {
  const id = row.id as string | undefined;
  return {
    id: row.id,
    lead_id: row.lead_id,
    version: row.version,
    status: row.status,
    package_name: row.package_name,
    setup_cents: row.setup_cents,
    monthly_cents: row.monthly_cents,
    mdr_pct: Number(row.mdr_pct ?? 0),
    notes: row.notes,
    created_at: row.created_at,
    sent_at: row.sent_at,
    operational_snapshot: row.operational_snapshot ?? null,
    document_source: row.document_source ?? null,
    document_saved_at: row.document_saved_at ?? null,
    template_version: row.template_version ?? null,
    pdf_generated_at: row.pdf_generated_at ?? null,
    pdf_url: id ? `/api/commercial/proposals/${id}/pdf` : null,
    docx_url: id ? `/api/commercial/proposals/${id}/docx` : null,
    has_pdf: Boolean(row.pdf_storage_path),
    has_docx: Boolean(row.docx_storage_path),
    /** Legado — propostas novas não populam. */
    document_html: row.document_html ?? null,
  };
}

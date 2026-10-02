import { generateCommercialProposalPdf } from './proposalPdf';
import { generateProposalPdfFromHtml } from './proposalPdfFromHtml';
import { buildProposalDocumentVars, buildDocumentSource } from './proposalDocumentVars';
import type { ProposalDocumentVars } from './proposalDocumentVars';
import { fillProposalDocx, getActiveTemplateMeta } from './proposalDocxFill';
import { convertProposalDocxToPdf, ProposalPdfConversionError } from './proposalDocxToPdf';
import {
  downloadProposalFile,
  proposalStoragePaths,
  uploadProposalFile,
} from './proposalStorage';
import { attachConfigToSnapshot, runLeadDimensioningWithConfig } from './commercialMotorRuntime';
import {
  applyCenarioSelectionById,
  type CenarioOperacionalId,
  type DimensionamentoResultado,
} from './operationalDimensioning';
import { rehydrateOperationalSnapshot, type PropostaComercialSnapshot } from './commercialSnapshotFinance';
import { isDimensionamentoConfirmed, type OperationalSnapshotStored } from './enhancedViability';
import { randomUUID } from 'crypto';
import { supabase } from '../supabase';

export class DimensionamentoNotConfirmedError extends Error {
  constructor() {
    super(
      'Dimensionamento operacional não aprovado. Calcule a viabilidade, revise a análise e clique em "Aprovar análise" antes de gerar o PDF.',
    );
    this.name = 'DimensionamentoNotConfirmedError';
  }
}

export class DimensionamentoMissingError extends Error {
  constructor() {
    super('Nenhum dimensionamento encontrado. Calcule a viabilidade na aba Viabilidade antes de gerar a proposta.');
    this.name = 'DimensionamentoMissingError';
  }
}

export class DimensionamentoScenarioRequiredError extends Error {
  constructor() {
    super('Selecione o cenário operacional (A ou B) antes de aprovar a análise.');
    this.name = 'DimensionamentoScenarioRequiredError';
  }
}

export class DimensionamentoScenarioInvalidError extends Error {
  constructor() {
    super('Cenário operacional inválido ou indisponível para este lead.');
    this.name = 'DimensionamentoScenarioInvalidError';
  }
}

export class ProposalPdfGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalPdfGenerationError';
  }
}

export async function runLeadDimensioning(
  workspaceId: string,
  lead: Record<string, unknown>,
): Promise<DimensionamentoResultado> {
  const { dimensionamento } = await runLeadDimensioningWithConfig(workspaceId, lead);
  return dimensionamento;
}

export async function saveLeadDimensioningSnapshot(
  workspaceId: string,
  leadId: string,
  dimensionamento: DimensionamentoResultado,
  configMeta?: { config_version: number; config_hash: string; config_applied_at: string },
): Promise<void> {
  const hydrated = rehydrateOperationalSnapshot(dimensionamento);
  const snapshot: OperationalSnapshotStored = {
    ...hydrated,
    confirmed_at: null,
    ...(configMeta ?? {}),
  };
  await supabase
    .from('commercial_leads')
    .update({
      operational_snapshot: snapshot,
      deal_value_cents: snapshot.valor_lead_anual_cents,
      drivers_count: snapshot.quantidade_entregadores_recomendada,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', leadId);
}

export async function confirmLeadDimensioning(
  workspaceId: string,
  leadId: string,
): Promise<OperationalSnapshotStored> {
  const { data: lead, error } = await supabase
    .from('commercial_leads')
    .select('operational_snapshot')
    .eq('workspace_id', workspaceId)
    .eq('id', leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead?.operational_snapshot) throw new DimensionamentoMissingError();

  const current = lead.operational_snapshot as OperationalSnapshotStored;
  if ((current.cenarios_alternativos?.length ?? 0) >= 2 && !current.cenario_selecionado) {
    throw new DimensionamentoScenarioRequiredError();
  }

  const confirmed: OperationalSnapshotStored = {
    ...current,
    confirmed_at: new Date().toISOString(),
  };

  const { error: updErr } = await supabase
    .from('commercial_leads')
    .update({ operational_snapshot: confirmed, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)
    .eq('id', leadId);
  if (updErr) throw new Error(updErr.message);

  return confirmed;
}

function leadFlatForDocument(lead: Record<string, unknown>): Record<string, unknown> {
  const cf = (lead.custom_fields as Record<string, unknown> | undefined) ?? {};
  return { ...cf, ...lead };
}

export async function selectLeadDimensioningScenario(
  workspaceId: string,
  leadId: string,
  cenarioId: CenarioOperacionalId,
  options?: { domingo_aberto?: boolean },
): Promise<OperationalSnapshotStored> {
  const { data: lead, error } = await supabase
    .from('commercial_leads')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead?.operational_snapshot) throw new DimensionamentoMissingError();

  const current = rehydrateOperationalSnapshot(
    lead.operational_snapshot as OperationalSnapshotStored,
  );
  const next: OperationalSnapshotStored = { ...current, confirmed_at: null };

  let effectiveId = cenarioId;
  if (cenarioId === 'enxuto' && options?.domingo_aberto === true) {
    effectiveId = 'enxuto_domingo';
  }

  if (!applyCenarioSelectionById(next, effectiveId)) {
    throw new DimensionamentoScenarioInvalidError();
  }

  next.proposta_comercial = {
    ...(next.proposta_comercial ?? { setup_cents: 0 }),
    cenario_a_domingo_aberto: effectiveId === 'enxuto_domingo',
  };

  const hydrated = rehydrateOperationalSnapshot(next);

  const { error: updErr } = await supabase
    .from('commercial_leads')
    .update({
      operational_snapshot: hydrated,
      deal_value_cents: hydrated.valor_lead_anual_cents,
      drivers_count: hydrated.quantidade_entregadores_recomendada,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', leadId);
  if (updErr) throw new Error(updErr.message);

  return hydrated;
}

export async function saveLeadPropostaComercial(
  workspaceId: string,
  leadId: string,
  input: Partial<PropostaComercialSnapshot>,
  userId?: string,
): Promise<OperationalSnapshotStored> {
  const { data: lead, error } = await supabase
    .from('commercial_leads')
    .select('operational_snapshot')
    .eq('workspace_id', workspaceId)
    .eq('id', leadId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!lead?.operational_snapshot) throw new DimensionamentoMissingError();

  const current = rehydrateOperationalSnapshot(
    lead.operational_snapshot as OperationalSnapshotStored,
  );
  const prevPc = current.proposta_comercial ?? { setup_cents: 0 };
  const mergedPc: PropostaComercialSnapshot = {
    ...prevPc,
    ...input,
    setup_cents: input.sem_setup ? 0 : (input.setup_cents ?? prevPc.setup_cents ?? 0),
    setup_pagamento: input.setup_pagamento ?? prevPc.setup_pagamento ?? 'a_vista',
  };

  const next: OperationalSnapshotStored = {
    ...current,
    proposta_comercial: mergedPc,
    confirmed_at: null,
  };

  if (
    input.cenario_a_domingo_aberto !== undefined &&
    next.cenarios_alternativos?.some((c) => c.id === 'enxuto_domingo')
  ) {
    const pick = input.cenario_a_domingo_aberto ? 'enxuto_domingo' : 'enxuto';
    applyCenarioSelectionById(next, pick);
  }

  if (input.valor_lead_override_cents != null && input.valor_lead_override_cents > 0) {
    const original = current.valor_lead_anual_cents;
    next.valor_lead_anual_cents = input.valor_lead_override_cents;
    const ajuste = {
      campo: 'valor_lead_anual_cents',
      valor_original: original,
      valor_ajustado: input.valor_lead_override_cents,
      motivo: input.override_motivo?.trim() || 'Ajuste comercial',
      ajustado_em: new Date().toISOString(),
      ajustado_por: userId,
    };
    next.proposta_comercial!.ajustes_manuais = [...(prevPc.ajustes_manuais ?? []), ajuste].slice(-10);
  } else if (input.valor_lead_override_cents === null) {
    next.proposta_comercial!.valor_lead_override_cents = null;
    next.proposta_comercial!.override_motivo = null;
    next.valor_lead_anual_cents = current.valor_lead_anual_cents;
  }

  await supabase
    .from('commercial_leads')
    .update({
      operational_snapshot: next,
      deal_value_cents: next.valor_lead_anual_cents,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)
    .eq('id', leadId);

  return rehydrateOperationalSnapshot(next);
}

async function buildVarsFromLead(
  lead: Record<string, unknown>,
  dimensionamento: DimensionamentoResultado,
  propostaComercial?: PropostaComercialSnapshot,
): Promise<ProposalDocumentVars> {
  return buildProposalDocumentVars({
    lead: leadFlatForDocument(lead),
    dimensionamento,
    propostaComercial,
  });
}

/** Preenche DOCX, gera PDF (Gotenberg) e persiste no storage. */
export async function storeProposalArtifacts(params: {
  workspaceId: string;
  proposalId: string;
  vars: ProposalDocumentVars;
}): Promise<{
  docxPath: string;
  pdfPath: string | null;
  templateId: string;
  templateVersion: number;
  documentSource: ReturnType<typeof buildDocumentSource>;
  pdfError?: string;
}> {
  const { id: templateId, version: templateVersion } = getActiveTemplateMeta();
  const docx = fillProposalDocx(params.vars);
  const paths = proposalStoragePaths(params.workspaceId, params.proposalId);

  await uploadProposalFile(
    paths.docx,
    docx,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  );

  let pdfPath: string | null = null;
  let pdfError: string | undefined;
  try {
    const pdf = await convertProposalDocxToPdf(docx);
    await uploadProposalFile(paths.pdf, pdf, 'application/pdf');
    pdfPath = paths.pdf;
  } catch (e) {
    pdfError = e instanceof Error ? e.message : String(e);
  }

  return {
    docxPath: paths.docx,
    pdfPath,
    templateId,
    templateVersion,
    documentSource: buildDocumentSource(params.vars, templateId, templateVersion),
    pdfError,
  };
}

export async function createProposalFromConfirmedSnapshot(params: {
  workspaceId: string;
  leadId: string;
  packageName: string;
  setupCents?: number;
  setupPagamento?: PropostaComercialSnapshot['setup_pagamento'];
  setupParcelas?: number | null;
  monthlyCents?: number;
  notes?: string | null;
}): Promise<{
  proposal: Record<string, unknown>;
  dimensionamento: DimensionamentoResultado;
  pdfWarning?: string;
}> {
  const { data: lead, error: leadErr } = await supabase
    .from('commercial_leads')
    .select('*')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.leadId)
    .maybeSingle();
  if (leadErr) throw new Error(leadErr.message);
  if (!lead) throw new Error('Lead não encontrado');

  const snapshot = lead.operational_snapshot as OperationalSnapshotStored | null;
  if (!snapshot?.perfil_operacao) throw new DimensionamentoMissingError();
  if (!isDimensionamentoConfirmed(snapshot)) throw new DimensionamentoNotConfirmedError();

  const dimensionamento = rehydrateOperationalSnapshot(snapshot as DimensionamentoResultado);
  const pc = dimensionamento.proposta_comercial;
  const propostaComercial: PropostaComercialSnapshot = {
    ...(pc ?? { setup_cents: 0 }),
    setup_cents: params.setupCents ?? pc?.setup_cents ?? 0,
    setup_pagamento: params.setupPagamento ?? pc?.setup_pagamento ?? 'a_vista',
    setup_parcelas: params.setupParcelas ?? pc?.setup_parcelas,
    package_name: params.packageName ?? pc?.package_name,
    sem_setup: pc?.sem_setup,
    setup_observacao: params.notes ?? pc?.setup_observacao,
  };

  const { data: last } = await supabase
    .from('commercial_proposals')
    .select('version')
    .eq('workspace_id', params.workspaceId)
    .eq('lead_id', params.leadId)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const version = (last?.version ? Number(last.version) : 0) + 1;
  const setupCents = propostaComercial.setup_cents ?? 0;
  const monthlyCents = params.monthlyCents ?? 0;
  const packageName = params.packageName ?? propostaComercial.package_name ?? 'Pacote padrão';
  const mdrPct = dimensionamento.valor_entrega_utilizado;
  const vars = await buildVarsFromLead(lead as Record<string, unknown>, dimensionamento, propostaComercial);

  const proposalId = randomUUID();
  const artifacts = await storeProposalArtifacts({
    workspaceId: params.workspaceId,
    proposalId,
    vars,
  });

  const now = new Date().toISOString();
  const status = artifacts.pdfPath ? 'pdf_ready' : 'draft';

  const { data: proposal, error: insErr } = await supabase
    .from('commercial_proposals')
    .insert({
      id: proposalId,
      workspace_id: params.workspaceId,
      lead_id: params.leadId,
      version,
      status,
      package_name: packageName,
      setup_cents: setupCents,
      monthly_cents: monthlyCents,
      mdr_pct: mdrPct,
      notes: params.notes ?? pc?.setup_observacao ?? null,
      operational_snapshot: { ...snapshot, ...dimensionamento },
      document_html: null,
      document_source: artifacts.documentSource,
      document_saved_at: now,
      template_version: artifacts.templateVersion,
      docx_storage_path: artifacts.docxPath,
      pdf_storage_path: artifacts.pdfPath,
      pdf_generated_at: artifacts.pdfPath ? now : null,
    })
    .select()
    .single();
  if (insErr) throw new Error(insErr.message);

  return {
    proposal: proposal as Record<string, unknown>,
    dimensionamento,
    pdfWarning: artifacts.pdfError,
  };
}

export async function regenerateProposalPdf(params: {
  workspaceId: string;
  proposalId: string;
}): Promise<Record<string, unknown>> {
  const { data: proposal } = await supabase
    .from('commercial_proposals')
    .select('*, lead:commercial_leads!lead_id(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.proposalId)
    .maybeSingle();
  if (!proposal) throw new Error('Proposta não encontrada');

  const lead = proposal.lead as Record<string, unknown>;
  const dimensionamento = rehydrateOperationalSnapshot(
    proposal.operational_snapshot as DimensionamentoResultado,
  );
  const vars = await buildVarsFromLead(lead, dimensionamento, dimensionamento.proposta_comercial);

  const artifacts = await storeProposalArtifacts({
    workspaceId: params.workspaceId,
    proposalId: params.proposalId,
    vars,
  });

  if (!artifacts.pdfPath) {
    throw new ProposalPdfGenerationError(
      artifacts.pdfError ?? 'Não foi possível gerar o PDF. Verifique o serviço Gotenberg.',
    );
  }

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('commercial_proposals')
    .update({
      document_source: artifacts.documentSource,
      document_html: null,
      document_saved_at: now,
      template_version: artifacts.templateVersion,
      docx_storage_path: artifacts.docxPath,
      pdf_storage_path: artifacts.pdfPath,
      pdf_generated_at: now,
      status: 'pdf_ready',
      updated_at: now,
    })
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.proposalId)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Falha ao atualizar proposta');

  return data as Record<string, unknown>;
}

export async function saveProposalNotes(params: {
  workspaceId: string;
  proposalId: string;
  notes: string | null;
}): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('commercial_proposals')
    .update({ notes: params.notes, updated_at: now })
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.proposalId)
    .select()
    .single();
  if (error || !data) throw new Error(error?.message ?? 'Proposta não encontrada');
  return data as Record<string, unknown>;
}

export async function loadProposalDocx(params: {
  workspaceId: string;
  proposalId: string;
}): Promise<{ buffer: Buffer; filename: string } | null> {
  const { data: proposal } = await supabase
    .from('commercial_proposals')
    .select('*, lead:commercial_leads!lead_id(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.proposalId)
    .maybeSingle();
  if (!proposal) return null;

  const lead = proposal.lead as Record<string, unknown>;
  const path = proposal.docx_storage_path as string | null;
  if (path) {
    const buf = await downloadProposalFile(path);
    if (buf) {
      const safeName = String(lead.trade_name || 'proposta')
        .replace(/[^\w\s-]/g, '')
        .trim()
        .replace(/\s+/g, '_');
      return { buffer: buf, filename: `Proposta_${safeName}_v${proposal.version}.docx` };
    }
  }

  const dimensionamento = rehydrateOperationalSnapshot(
    proposal.operational_snapshot as DimensionamentoResultado,
  );
  const vars = await buildVarsFromLead(lead, dimensionamento, dimensionamento.proposta_comercial);
  const buffer = fillProposalDocx(vars);
  const safeName = String(lead.trade_name || 'proposta')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  return { buffer, filename: `Proposta_${safeName}_v${proposal.version}.docx` };
}

export async function loadProposalPdf(params: {
  workspaceId: string;
  proposalId: string;
}): Promise<{ buffer: Buffer; filename: string } | null> {
  const { data: proposal } = await supabase
    .from('commercial_proposals')
    .select('*, lead:commercial_leads!lead_id(*)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.proposalId)
    .maybeSingle();
  if (!proposal) return null;

  const lead = proposal.lead as Record<string, unknown>;
  const safeName = String(lead.trade_name || 'proposta')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '_');
  const filename = `Proposta_${safeName}_v${proposal.version}.pdf`;

  const pdfPath = proposal.pdf_storage_path as string | null;
  if (pdfPath) {
    const buf = await downloadProposalFile(pdfPath);
    if (buf) return { buffer: buf, filename };
  }

  if (proposal.document_html) {
    const title = `Proposta — ${lead.trade_name ?? 'Cliente'}`;
    const buffer = await generateProposalPdfFromHtml(String(proposal.document_html), title);
    return { buffer, filename };
  }

  const docxPath = proposal.docx_storage_path as string | null;
  if (docxPath) {
    const docx = await downloadProposalFile(docxPath);
    if (docx) {
      try {
        const buffer = await convertProposalDocxToPdf(docx);
        return { buffer, filename };
      } catch {
        /* fall through */
      }
    }
  }

  const dimensionamento =
    (proposal.operational_snapshot as DimensionamentoResultado | null) ??
    (await runLeadDimensioning(params.workspaceId, lead));

  const buffer = await generateCommercialProposalPdf({
    trade_name: String(lead.trade_name),
    legal_name: lead.legal_name as string | null,
    city: String(lead.city),
    state: String(lead.state),
    contact_name: String(lead.contact_name ?? lead.trade_name),
    package_name: String(proposal.package_name),
    version: Number(proposal.version),
    dimensionamento,
    setup_cents: Number(proposal.setup_cents ?? 0),
    monthly_cents: Number(proposal.monthly_cents ?? 0),
  });

  return { buffer, filename };
}

export { attachConfigToSnapshot };

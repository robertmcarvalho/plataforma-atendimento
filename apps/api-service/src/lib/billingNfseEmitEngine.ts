/**
 * Sprint 3 — approve → gate tomador → fila NFS-e → emit (produção restrita).
 * Fatura permanece `approved` mesmo se a emissão falhar / ficar pending.
 */

import {
  buildDpsXml,
  onlyDigits,
  renderNfseDescriptionTemplate,
  type NfseDpsBuildInput,
} from './billingNfseDpsBuilder';
import { buildCancelEventXml } from './billingNfseEventBuilder';
import {
  defaultSecretRefForEntity,
  isBillingNfseEnabled,
  pickServiceProfile,
  resolveInvoiceRevenueLine,
  resolveNfseEnvironment,
} from './billingNfseConfig';
import { BillingNfseSefinClient, BillingNfseSefinClientError } from './billingNfseSefinClient';
import {
  loadPfxMaterial,
  pfxFileExists,
  resolvePfxPassword,
  signDpsXmlToGzipBase64,
  signPedRegEventoXmlToGzipBase64,
} from './billingNfseSigner';
import { resolveDanfsePdfBuffer } from './billingNfseDanfsePdf';
import { buildBillingArtifactFilename } from './billingArtifactFilename';
import {
  decodeNfseXmlGzipB64,
  downloadNfseArtifact,
  persistNfseDocumentArtifacts,
} from './billingNfseStorage';
import { evaluateNfseTomadorGate, resolveTomadorCityState } from './billingNfseTomadorGate';
import { BILLING_INVOICE_APPROVE_SELECT_CORE } from './pharmacyNfseWrite';
import {
  BILLING_NFSE_AUDIT_CODES,
  BILLING_NFSE_CANCELABLE_STATUSES,
  BILLING_NFSE_REEMITTABLE_STATUSES,
  BillingNfseApproveError,
  NFSE_TOMADOR_INCOMPLETE_CODE,
  type BillingNfseDocument,
  type BillingNfseDocumentStatus,
  type BillingNfseEntityType,
  type BillingNfseIssuerConfig,
  type BillingNfseRevenueLine,
  type BillingNfseServiceProfile,
} from './billingNfseTypes';

export { BillingNfseApproveError } from './billingNfseTypes';

type SupabaseClient = typeof import('./supabase').supabase;

async function getSupabase(): Promise<SupabaseClient> {
  const mod = await import('./supabase');
  return mod.supabase;
}

async function notify(input: Parameters<typeof import('./billingAuditNotifications').addBillingAuditNotification>[0]) {
  try {
    const { addBillingAuditNotification } = await import('./billingAuditNotifications');
    await addBillingAuditNotification(input);
  } catch {
    /* notificação não deve derrubar approve/emit */
  }
}

function mapDocument(row: Record<string, unknown>): BillingNfseDocument {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    invoice_id: String(row.invoice_id),
    issuer_config_id: row.issuer_config_id != null ? String(row.issuer_config_id) : null,
    entity_type: row.entity_type as BillingNfseEntityType,
    revenue_line: (row.revenue_line as BillingNfseRevenueLine) || 'delivery',
    status: row.status as BillingNfseDocumentStatus,
    attempt_number: Number(row.attempt_number) || 1,
    dps_number: row.dps_number != null ? String(row.dps_number) : null,
    nfse_number: row.nfse_number != null ? String(row.nfse_number) : null,
    access_key: row.access_key != null ? String(row.access_key) : null,
    protocol: row.protocol != null ? String(row.protocol) : null,
    last_error: row.last_error != null ? String(row.last_error) : null,
    dps_xml_storage_path:
      row.dps_xml_storage_path != null ? String(row.dps_xml_storage_path) : null,
    xml_storage_path: row.xml_storage_path != null ? String(row.xml_storage_path) : null,
    pdf_storage_path: row.pdf_storage_path != null ? String(row.pdf_storage_path) : null,
    issued_at: row.issued_at != null ? String(row.issued_at) : null,
    authorized_at: row.authorized_at != null ? String(row.authorized_at) : null,
  };
}

export function canReemitNfseDocument(status: BillingNfseDocumentStatus | string | null | undefined): boolean {
  return BILLING_NFSE_REEMITTABLE_STATUSES.includes(status as BillingNfseDocumentStatus);
}

export function canCancelNfseDocument(status: BillingNfseDocumentStatus | string | null | undefined): boolean {
  return BILLING_NFSE_CANCELABLE_STATUSES.includes(status as BillingNfseDocumentStatus);
}

function formatBrDate(isoOrDate: string | null | undefined): string {
  if (!isoOrDate) return '';
  const d = String(isoOrDate).slice(0, 10);
  const [y, m, day] = d.split('-');
  if (!y || !m || !day) return d;
  return `${day}/${m}/${y}`;
}

function safeErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 500);
  return String(err).slice(0, 500);
}

async function loadIssuerBundle(
  workspaceId: string,
  entityType: BillingNfseEntityType,
  revenueLine: BillingNfseRevenueLine = 'delivery'
): Promise<{
  issuer: BillingNfseIssuerConfig;
  profile: BillingNfseServiceProfile | null;
  revenueLine: BillingNfseRevenueLine;
  secretRef: string | null;
}> {
  const supabase = await getSupabase();
  const { data: issuerRow, error: issuerErr } = await supabase
    .from('billing_nfse_issuer_configs')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('entity_type', entityType)
    .maybeSingle();
  if (issuerErr) throw new BillingNfseApproveError(issuerErr.message, { status: 500 });
  if (!issuerRow) {
    throw new BillingNfseApproveError(`Config NFS-e ausente para emitente ${entityType}.`, {
      status: 422,
      code: 'NFSE_ISSUER_MISSING',
    });
  }

  const issuer: BillingNfseIssuerConfig = {
    id: String(issuerRow.id),
    workspace_id: String(issuerRow.workspace_id),
    entity_type: entityType,
    environment: resolveNfseEnvironment(issuerRow.environment),
    auto_emit_on_approve: issuerRow.auto_emit_on_approve !== false,
    municipal_registration: (issuerRow.municipal_registration as string | null) ?? null,
    ibge_city_code: String(issuerRow.ibge_city_code || '3170206'),
    tax_regime: (issuerRow.tax_regime as string | null) ?? null,
    simples_nacional: Boolean(issuerRow.simples_nacional),
    dps_series: (issuerRow.dps_series as string | null) ?? null,
    dps_next_number: issuerRow.dps_next_number != null ? Number(issuerRow.dps_next_number) : null,
    active: issuerRow.active !== false,
  };

  const { data: profiles, error: profilesErr } = await supabase
    .from('billing_nfse_service_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('issuer_config_id', issuer.id);
  if (profilesErr) throw new BillingNfseApproveError(profilesErr.message, { status: 500 });

  const mappedProfiles: BillingNfseServiceProfile[] = (profiles || []).map((p) => ({
    id: String(p.id),
    workspace_id: String(p.workspace_id),
    issuer_config_id: String(p.issuer_config_id),
    revenue_line: p.revenue_line as BillingNfseRevenueLine,
    ctn: String(p.ctn || ''),
    nbs: String(p.nbs || ''),
    iss_rate_pct: p.iss_rate_pct != null ? Number(p.iss_rate_pct) : null,
    description_template: String(p.description_template || ''),
    active: p.active !== false,
  }));

  const { data: cert } = await supabase
    .from('billing_nfse_certificates')
    .select('secret_ref, active')
    .eq('workspace_id', workspaceId)
    .eq('issuer_config_id', issuer.id)
    .eq('active', true)
    .maybeSingle();

  const secretRef =
    (cert?.secret_ref != null && String(cert.secret_ref).trim()) ||
    defaultSecretRefForEntity(entityType);

  const resolvedLine = resolveInvoiceRevenueLine({ revenue_line: revenueLine });
  return {
    issuer,
    profile: pickServiceProfile(mappedProfiles, resolvedLine),
    revenueLine: resolvedLine,
    secretRef,
  };
}

async function allocateDpsNumber(issuerId: string): Promise<{ series: string; number: number }> {
  const supabase = await getSupabase();
  const { data: row, error } = await supabase
    .from('billing_nfse_issuer_configs')
    .select('dps_series, dps_next_number')
    .eq('id', issuerId)
    .maybeSingle();
  if (error) throw new BillingNfseApproveError(error.message, { status: 500 });

  const series = String(row?.dps_series || '1').trim() || '1';
  const current = row?.dps_next_number != null && Number(row.dps_next_number) >= 1 ? Number(row.dps_next_number) : 1;

  const { error: updErr } = await supabase
    .from('billing_nfse_issuer_configs')
    .update({ dps_next_number: current + 1, updated_at: new Date().toISOString() })
    .eq('id', issuerId);
  if (updErr) throw new BillingNfseApproveError(updErr.message, { status: 500 });

  return { series, number: current };
}

export type EmitNfseResult = {
  document: BillingNfseDocument;
  emitted: boolean;
  authorized: boolean;
  error?: string;
};

/**
 * Tenta emitir DPS para um documento `pending` já criado.
 * Coop sem PFX → falha graciosa (last_error claro); Flux com PFX segue Sprint 2 stack.
 */
export async function tryEmitNfseDocument(params: {
  workspaceId: string;
  documentId: string;
  invoice: {
    id: string;
    entity_type: BillingNfseEntityType;
    total_cents: number;
    pharmacy_id: string;
    billing_cycle_id: string;
  };
  pharmacy: Record<string, unknown>;
  cycle: { apuracao_start?: string | null; apuracao_end?: string | null; label?: string | null } | null;
  issuer: BillingNfseIssuerConfig;
  profile: BillingNfseServiceProfile;
  secretRef: string;
  legalEntityCnpj: string;
}): Promise<EmitNfseResult> {
  const supabase = await getSupabase();
  const now = new Date().toISOString();

  if (!pfxFileExists(params.secretRef)) {
    const msg = `Certificado A1 ausente para ${params.invoice.entity_type} (secret_ref=${params.secretRef}). Coloque o PFX em .secrets/.`;
    const { data: doc } = await supabase
      .from('billing_nfse_documents')
      .update({
        status: 'rejected',
        last_error: msg,
        updated_at: now,
      })
      .eq('id', params.documentId)
      .eq('workspace_id', params.workspaceId)
      .select('*')
      .maybeSingle();

    await notify({
      workspaceId: params.workspaceId,
      billingCycleId: params.invoice.billing_cycle_id,
      pharmacyId: params.invoice.pharmacy_id,
      severity: 'warning',
      code: BILLING_NFSE_AUDIT_CODES.CERT_MISSING,
      title: `NFS-e: certificado ausente (${params.invoice.entity_type})`,
      message: msg,
      metadata: {
        invoice_id: params.invoice.id,
        document_id: params.documentId,
        entity_type: params.invoice.entity_type,
        secret_ref: params.secretRef,
      },
    }).catch(() => undefined);

    return {
      document: mapDocument((doc || { id: params.documentId, workspace_id: params.workspaceId, invoice_id: params.invoice.id, entity_type: params.invoice.entity_type, status: 'rejected', attempt_number: 1, revenue_line: params.profile.revenue_line }) as Record<string, unknown>),
      emitted: false,
      authorized: false,
      error: msg,
    };
  }

  try {
    const { series, number: dpsNumber } = await allocateDpsNumber(params.issuer.id);
    const { city, state } = resolveTomadorCityState(params.pharmacy as never);
    const pharmacyName =
      String(params.pharmacy.trade_name || params.pharmacy.legal_name || '').trim() || 'Farmácia';

    const description = renderNfseDescriptionTemplate(params.profile.description_template, {
      cycle_start: formatBrDate(params.cycle?.apuracao_start),
      cycle_end: formatBrDate(params.cycle?.apuracao_end),
      pharmacy: pharmacyName,
    });

    const buildInput: NfseDpsBuildInput = {
      environment: resolveNfseEnvironment(params.issuer.environment),
      entity_type: params.invoice.entity_type,
      revenue_line: params.profile.revenue_line,
      dps_series: series,
      dps_number: dpsNumber,
      competence_date: String(params.cycle?.apuracao_end || params.cycle?.apuracao_start || now).slice(0, 10),
      issued_at: now,
      simples_nacional: params.issuer.simples_nacional,
      special_tax_regime: params.issuer.tax_regime,
      prestador: {
        cnpj: onlyDigits(params.legalEntityCnpj),
        municipal_registration: params.issuer.municipal_registration,
        ibge_city_code: params.issuer.ibge_city_code,
      },
      tomador: {
        cnpj: onlyDigits(String(params.pharmacy.cnpj || '')),
        legal_name: String(params.pharmacy.legal_name || pharmacyName),
        municipal_registration: (params.pharmacy.municipal_registration as string | null) ?? null,
        address: {
          street: String(params.pharmacy.address_street || ''),
          number: String(params.pharmacy.address_number || ''),
          neighborhood: String(params.pharmacy.address_neighborhood || ''),
          ibge_city_code: onlyDigits(String(params.pharmacy.ibge_city_code || '')),
          cep: onlyDigits(String(params.pharmacy.address_cep || '')),
          city,
          state,
        },
      },
      servico: {
        ctn: params.profile.ctn,
        nbs: params.profile.nbs,
        description,
        // Local da prestação = município da farmácia (tomador), não do emitente.
        ibge_prestacao: onlyDigits(String(params.pharmacy.ibge_city_code || '')),
      },
      valores: {
        service_amount: Math.max(0, Number(params.invoice.total_cents) || 0) / 100,
        iss_retained: false,
        iss_rate_pct: params.profile.iss_rate_pct,
      },
    };

    const built = buildDpsXml(buildInput);
    // Carrega PFX com senha do arquivo .password / env — nunca logar senha/PEM.
    const password = resolvePfxPassword(params.secretRef);
    const material = loadPfxMaterial(params.secretRef, password);
    const { dpsXmlGZipB64, signedXml } = signDpsXmlToGzipBase64(built.xml, material);

    const client = new BillingNfseSefinClient({
      environment: resolveNfseEnvironment(params.issuer.environment),
      material,
    });
    const response = await client.postNfseWithHttps(dpsXmlGZipB64);

    if (response.ok) {
      let storagePaths: Awaited<ReturnType<typeof persistNfseDocumentArtifacts>> = {
        dps_xml_storage_path: null,
        xml_storage_path: null,
        pdf_storage_path: null,
        cancel_event_xml_storage_path: null,
      };
      try {
        let nfseXmlGZipB64 = response.nfseXmlGZipB64 || null;
        if (!nfseXmlGZipB64 && response.chaveAcesso) {
          try {
            const consult = await client.getNfseByChave(response.chaveAcesso);
            if (consult.nfseXmlGZipB64) nfseXmlGZipB64 = consult.nfseXmlGZipB64;
          } catch {
            /* consulta opcional — autorização já ok */
          }
        }
        let adnPdf: Buffer | null = null;
        if (response.chaveAcesso) {
          try {
            const danfse = await client.getDanfsePdf(response.chaveAcesso);
            if (danfse.ok && danfse.pdf) adnPdf = danfse.pdf;
          } catch {
            /* ADN DANFSe opcional (NT 008 desativou GET /danfse) */
          }
        }
        let nfseXmlBuf: Buffer | null = null;
        if (nfseXmlGZipB64) {
          try {
            nfseXmlBuf = decodeNfseXmlGzipB64(nfseXmlGZipB64);
          } catch {
            nfseXmlBuf = null;
          }
        }
        const resolvedPdf = await resolveDanfsePdfBuffer({
          adnPdf,
          nfseXml: nfseXmlBuf,
          accessKey: response.chaveAcesso,
        });
        storagePaths = await persistNfseDocumentArtifacts({
          workspaceId: params.workspaceId,
          documentId: params.documentId,
          dpsXml: signedXml,
          nfseXmlGZipB64,
          nfseXmlBuffer: nfseXmlBuf,
          danfsePdf: resolvedPdf?.pdf ?? null,
        });
      } catch (storageErr) {
        // Autorização Sefin não deve falhar por storage; last_error fica nulo, paths podem faltar.
        await notify({
          workspaceId: params.workspaceId,
          billingCycleId: params.invoice.billing_cycle_id,
          pharmacyId: params.invoice.pharmacy_id,
          severity: 'warning',
          code: BILLING_NFSE_AUDIT_CODES.EMIT_FAILED,
          title: 'NFS-e autorizada, falha ao persistir XML/PDF',
          message: safeErrorMessage(storageErr),
          metadata: {
            invoice_id: params.invoice.id,
            document_id: params.documentId,
            chave_acesso: response.chaveAcesso,
          },
        }).catch(() => undefined);
      }

      const { data: doc } = await supabase
        .from('billing_nfse_documents')
        .update({
          status: 'authorized',
          dps_number: built.n_dps,
          access_key: response.chaveAcesso,
          protocol: response.idDps,
          last_error: null,
          issued_at: now,
          authorized_at: now,
          dps_xml_storage_path: storagePaths.dps_xml_storage_path,
          xml_storage_path: storagePaths.xml_storage_path,
          pdf_storage_path: storagePaths.pdf_storage_path,
          updated_at: now,
        })
        .eq('id', params.documentId)
        .eq('workspace_id', params.workspaceId)
        .select('*')
        .maybeSingle();

      await notify({
        workspaceId: params.workspaceId,
        billingCycleId: params.invoice.billing_cycle_id,
        pharmacyId: params.invoice.pharmacy_id,
        severity: 'info',
        code: BILLING_NFSE_AUDIT_CODES.AUTHORIZED,
        title: 'NFS-e autorizada',
        message: `NFS-e autorizada para fatura ${params.invoice.id.slice(0, 8)}… (${params.invoice.entity_type}).`,
        metadata: {
          invoice_id: params.invoice.id,
          document_id: params.documentId,
          entity_type: params.invoice.entity_type,
          chave_acesso: response.chaveAcesso,
          dps_number: built.n_dps,
          has_xml: Boolean(storagePaths.xml_storage_path),
          has_pdf: Boolean(storagePaths.pdf_storage_path),
        },
      }).catch(() => undefined);

      return {
        document: mapDocument((doc || {}) as Record<string, unknown>),
        emitted: true,
        authorized: true,
      };
    }

    // Rejeição: ainda grava DPS assinado para auditoria (best-effort).
    try {
      const dpsPaths = await persistNfseDocumentArtifacts({
        workspaceId: params.workspaceId,
        documentId: params.documentId,
        dpsXml: signedXml,
      });
      if (dpsPaths.dps_xml_storage_path) {
        await supabase
          .from('billing_nfse_documents')
          .update({
            dps_xml_storage_path: dpsPaths.dps_xml_storage_path,
            updated_at: now,
          })
          .eq('id', params.documentId)
          .eq('workspace_id', params.workspaceId);
      }
    } catch {
      /* ignore */
    }

    const errMsg =
      (response.erros || [])
        .map((e) => [e.codigo, e.descricao].filter(Boolean).join(' '))
        .filter(Boolean)
        .join('; ') || `Sefin HTTP ${response.status}`;

    const { data: doc } = await supabase
      .from('billing_nfse_documents')
      .update({
        status: 'rejected',
        dps_number: built.n_dps,
        last_error: errMsg.slice(0, 500),
        issued_at: now,
        updated_at: now,
      })
      .eq('id', params.documentId)
      .eq('workspace_id', params.workspaceId)
      .select('*')
      .maybeSingle();

    await notify({
      workspaceId: params.workspaceId,
      billingCycleId: params.invoice.billing_cycle_id,
      pharmacyId: params.invoice.pharmacy_id,
      severity: 'warning',
      code: BILLING_NFSE_AUDIT_CODES.REJECTED,
      title: 'NFS-e rejeitada pela Sefin',
      message: errMsg.slice(0, 300),
      metadata: {
        invoice_id: params.invoice.id,
        document_id: params.documentId,
        entity_type: params.invoice.entity_type,
        http_status: response.status,
      },
    }).catch(() => undefined);

    return {
      document: mapDocument((doc || {}) as Record<string, unknown>),
      emitted: true,
      authorized: false,
      error: errMsg,
    };
  } catch (err) {
    const msg = safeErrorMessage(err);
    const { data: doc } = await supabase
      .from('billing_nfse_documents')
      .update({
        status: 'rejected',
        last_error: msg,
        updated_at: now,
      })
      .eq('id', params.documentId)
      .eq('workspace_id', params.workspaceId)
      .select('*')
      .maybeSingle();

    await notify({
      workspaceId: params.workspaceId,
      billingCycleId: params.invoice.billing_cycle_id,
      pharmacyId: params.invoice.pharmacy_id,
      severity: 'critical',
      code: BILLING_NFSE_AUDIT_CODES.EMIT_FAILED,
      title: 'Falha na emissão NFS-e',
      message: msg,
      metadata: {
        invoice_id: params.invoice.id,
        document_id: params.documentId,
        entity_type: params.invoice.entity_type,
      },
    }).catch(() => undefined);

    return {
      document: mapDocument(
        (doc || {
          id: params.documentId,
          workspace_id: params.workspaceId,
          invoice_id: params.invoice.id,
          entity_type: params.invoice.entity_type,
          status: 'rejected',
          attempt_number: 1,
          revenue_line: params.profile.revenue_line,
          last_error: msg,
        }) as Record<string, unknown>
      ),
      emitted: false,
      authorized: false,
      error: msg,
    };
  }
}

export type ApproveInvoiceNfseResult = {
  invoice: Record<string, unknown>;
  nfse_enabled: boolean;
  nfse?: {
    document: BillingNfseDocument;
    emit?: EmitNfseResult;
  };
};

/**
 * Aprova fatura draft. Com BILLING_NFSE_ENABLED:
 * - bloqueia se tomador incompleto (422 NFSE_TOMADOR_INCOMPLETE)
 * - cria documento pending + tenta emit se auto_emit_on_approve
 * - fatura permanece approved independentemente do resultado da NF
 */
export async function approveBillingInvoiceWithNfse(params: {
  workspaceId: string;
  invoiceId: string;
  actorId: string;
}): Promise<ApproveInvoiceNfseResult> {
  const supabase = await getSupabase();
  const now = new Date().toISOString();
  const nfseEnabled = isBillingNfseEnabled();

  const { data: invoice, error: invErr } = await supabase
    .from('billing_invoices')
    .select(BILLING_INVOICE_APPROVE_SELECT_CORE)
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.invoiceId)
    .maybeSingle();
  if (invErr) throw new BillingNfseApproveError(invErr.message, { status: 500 });
  if (!invoice) {
    throw new BillingNfseApproveError('Fatura não encontrada', { status: 404, code: 'INVOICE_NOT_FOUND' });
  }
  if (invoice.status !== 'draft') {
    throw new BillingNfseApproveError('Fatura não encontrada ou já aprovada', {
      status: 404,
      code: 'INVOICE_NOT_DRAFT',
    });
  }

  const entityType = invoice.entity_type as BillingNfseEntityType;

  let pharmacy: Record<string, unknown> | null = null;
  if (nfseEnabled) {
    const { data: pharmacyRow, error: phErr } = await supabase
      .from('pharmacies')
      .select(
        'id, trade_name, legal_name, cnpj, city, state, address_cep, address_street, address_number, address_neighborhood, ibge_city_code, municipal_registration'
      )
      .eq('id', invoice.pharmacy_id)
      .maybeSingle();
    if (phErr) throw new BillingNfseApproveError(phErr.message, { status: 500 });
    pharmacy = (pharmacyRow || null) as Record<string, unknown> | null;
    const gate = evaluateNfseTomadorGate(pharmacy as Parameters<typeof evaluateNfseTomadorGate>[0]);
    if (!gate.ok) {
      await notify({
        workspaceId: params.workspaceId,
        billingCycleId: invoice.billing_cycle_id,
        pharmacyId: invoice.pharmacy_id,
        severity: 'warning',
        code: BILLING_NFSE_AUDIT_CODES.TOMADOR_INCOMPLETE,
        title: 'Aprovação bloqueada: cadastro fiscal incompleto',
        message: `Preencha: ${gate.gaps.map((g) => g.label).join(', ')}`,
        metadata: {
          invoice_id: invoice.id,
          entity_type: entityType,
          gaps: gate.gaps.map((g) => g.code),
        },
      }).catch(() => undefined);

      throw new BillingNfseApproveError(
        'Cadastro fiscal do tomador incompleto. Complete os dados da farmácia antes de aprovar.',
        {
          status: 422,
          code: NFSE_TOMADOR_INCOMPLETE_CODE,
          gaps: gate.gaps,
        }
      );
    }
  }

  const { data: approved, error: updErr } = await supabase
    .from('billing_invoices')
    .update({
      status: 'approved',
      approved_at: now,
      approved_by: params.actorId,
      updated_at: now,
    })
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.invoiceId)
    .eq('status', 'draft')
    .select(BILLING_INVOICE_APPROVE_SELECT_CORE)
    .maybeSingle();
  if (updErr) throw new BillingNfseApproveError(updErr.message, { status: 500 });
  if (!approved) {
    throw new BillingNfseApproveError('Fatura não encontrada ou já aprovada', {
      status: 404,
      code: 'INVOICE_NOT_DRAFT',
    });
  }

  if (!nfseEnabled) {
    return { invoice: approved as Record<string, unknown>, nfse_enabled: false };
  }

  const { data: nfseInvoice, error: nfseInvErr } = await supabase
    .from('billing_invoices')
    .select('revenue_line, billing_invoice_lines(metadata)')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.invoiceId)
    .maybeSingle();
  if (nfseInvErr) throw new BillingNfseApproveError(nfseInvErr.message, { status: 500 });

  let bundle: Awaited<ReturnType<typeof loadIssuerBundle>>;
  const revenueLine = resolveInvoiceRevenueLine({
    revenue_line: (nfseInvoice as { revenue_line?: unknown } | null)?.revenue_line,
    lines: ((nfseInvoice as { billing_invoice_lines?: Array<{ metadata?: Record<string, unknown> | null }> } | null)
      ?.billing_invoice_lines || []) as Array<{ metadata?: Record<string, unknown> | null }>,
  });
  try {
    bundle = await loadIssuerBundle(params.workspaceId, entityType, revenueLine);
  } catch (err) {
    if (err instanceof BillingNfseApproveError) throw err;
    throw new BillingNfseApproveError(safeErrorMessage(err), { status: 500 });
  }

  if (!bundle.issuer.active || !bundle.issuer.auto_emit_on_approve) {
    return { invoice: approved as Record<string, unknown>, nfse_enabled: true };
  }

  if (!bundle.profile) {
    await notify({
      workspaceId: params.workspaceId,
      billingCycleId: invoice.billing_cycle_id,
      pharmacyId: invoice.pharmacy_id,
      severity: 'warning',
      code: BILLING_NFSE_AUDIT_CODES.EMIT_FAILED,
      title: `NFS-e: perfil ${bundle.revenueLine} inativo`,
      message: `Sem perfil ${bundle.revenueLine} ativo para ${entityType}.`,
      metadata: {
        invoice_id: invoice.id,
        entity_type: entityType,
        revenue_line: bundle.revenueLine,
      },
    }).catch(() => undefined);
    return { invoice: approved as Record<string, unknown>, nfse_enabled: true };
  }

  const { data: prevDocs } = await supabase
    .from('billing_nfse_documents')
    .select('attempt_number')
    .eq('workspace_id', params.workspaceId)
    .eq('invoice_id', invoice.id)
    .order('attempt_number', { ascending: false })
    .limit(1);
  const attempt = (prevDocs?.[0]?.attempt_number != null ? Number(prevDocs[0].attempt_number) : 0) + 1;

  const { data: docRow, error: docErr } = await supabase
    .from('billing_nfse_documents')
    .insert({
      workspace_id: params.workspaceId,
      invoice_id: invoice.id,
      issuer_config_id: bundle.issuer.id,
      entity_type: entityType,
      revenue_line: bundle.revenueLine,
      status: 'pending',
      attempt_number: attempt,
      updated_at: now,
    })
    .select('*')
    .single();
  if (docErr) throw new BillingNfseApproveError(docErr.message, { status: 500 });

  const document = mapDocument(docRow as Record<string, unknown>);

  await notify({
    workspaceId: params.workspaceId,
    billingCycleId: invoice.billing_cycle_id,
    pharmacyId: invoice.pharmacy_id,
    severity: 'info',
    code: BILLING_NFSE_AUDIT_CODES.PENDING,
    title: 'NFS-e pendente de autorização',
    message: `Fatura aprovada; NFS-e ${entityType} em processamento (tentativa ${attempt}).`,
    metadata: {
      invoice_id: invoice.id,
      document_id: document.id,
      entity_type: entityType,
      attempt_number: attempt,
    },
  }).catch(() => undefined);

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, label, apuracao_start, apuracao_end')
    .eq('id', invoice.billing_cycle_id)
    .maybeSingle();

  const { data: legal } = await supabase
    .from('billing_legal_entities')
    .select('cnpj')
    .eq('workspace_id', params.workspaceId)
    .eq('entity_type', entityType)
    .maybeSingle();

  const legalCnpj = onlyDigits(String(legal?.cnpj || ''));
  if (legalCnpj.length !== 14) {
    const msg = `CNPJ do emitente ${entityType} ausente/inválido em billing_legal_entities.`;
    await supabase
      .from('billing_nfse_documents')
      .update({ status: 'rejected', last_error: msg, updated_at: now })
      .eq('id', document.id);
    await notify({
      workspaceId: params.workspaceId,
      billingCycleId: invoice.billing_cycle_id,
      pharmacyId: invoice.pharmacy_id,
      severity: 'critical',
      code: BILLING_NFSE_AUDIT_CODES.EMIT_FAILED,
      title: 'NFS-e: CNPJ do emitente inválido',
      message: msg,
      metadata: { invoice_id: invoice.id, document_id: document.id, entity_type: entityType },
    }).catch(() => undefined);
    return {
      invoice: approved as Record<string, unknown>,
      nfse_enabled: true,
      nfse: {
        document: { ...document, status: 'rejected', last_error: msg },
      },
    };
  }

  const emit = await tryEmitNfseDocument({
    workspaceId: params.workspaceId,
    documentId: document.id,
    invoice: {
      id: String(invoice.id),
      entity_type: entityType,
      total_cents: Number(invoice.total_cents) || 0,
      pharmacy_id: String(invoice.pharmacy_id),
      billing_cycle_id: String(invoice.billing_cycle_id),
    },
    pharmacy: (pharmacy || {}) as Record<string, unknown>,
    cycle: cycle || null,
    issuer: bundle.issuer,
    profile: bundle.profile,
    secretRef: bundle.secretRef || defaultSecretRefForEntity(entityType),
    legalEntityCnpj: legalCnpj,
  });

  return {
    invoice: approved as Record<string, unknown>,
    nfse_enabled: true,
    nfse: { document: emit.document, emit },
  };
}

/** Último documento NFS-e por fatura (para listagem / badge). */
export async function loadLatestNfseDocumentsForInvoices(
  workspaceId: string,
  invoiceIds: string[]
): Promise<Map<string, BillingNfseDocument>> {
  const map = new Map<string, BillingNfseDocument>();
  if (!invoiceIds.length) return map;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('billing_nfse_documents')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('invoice_id', invoiceIds)
    .order('created_at', { ascending: false });
  if (error) throw new Error(error.message);
  for (const row of data || []) {
    const invId = String(row.invoice_id);
    if (map.has(invId)) continue;
    map.set(invId, mapDocument(row as Record<string, unknown>));
  }
  return map;
}

export async function loadNfseDocumentById(
  workspaceId: string,
  documentId: string
): Promise<BillingNfseDocument | null> {
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('billing_nfse_documents')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('id', documentId)
    .maybeSingle();
  if (error) throw new BillingNfseApproveError(error.message, { status: 500 });
  if (!data) return null;
  return mapDocument(data as Record<string, unknown>);
}

/**
 * Backfill NFS-e XML (via Sefin) e/ou PDF DANFSe (lib Java portal-patched preferida;
 * NT 008 / auxiliar como fallback). ADN GET /danfse pode estar desativada (NT 008/2026).
 * Usado no download sob demanda (botão PDF/XML).
 */
export async function backfillNfseDocumentArtifacts(params: {
  workspaceId: string;
  documentId: string;
  /** Se true e XML existe, regenera PDF mesmo com pdf_storage_path. */
  forcePdfRegen?: boolean;
}): Promise<BillingNfseDocument> {
  const supabase = await getSupabase();
  const doc = await loadNfseDocumentById(params.workspaceId, params.documentId);
  if (!doc) {
    throw new BillingNfseApproveError('Documento NFS-e não encontrado', {
      status: 404,
      code: 'NFSE_DOCUMENT_NOT_FOUND',
    });
  }
  if (doc.status !== 'authorized' && doc.status !== 'canceled') {
    throw new BillingNfseApproveError('Backfill só é permitido para NFS-e autorizada ou cancelada', {
      status: 422,
      code: 'NFSE_BACKFILL_STATUS',
    });
  }
  if (doc.xml_storage_path && doc.pdf_storage_path && !params.forcePdfRegen) return doc;

  let nfseXmlGZipB64: string | null = null;
  let nfseXmlBuf: Buffer | null = null;
  let adnPdf: Buffer | null = null;

  // Caminho rápido: XML já no storage → DANFSe lib / NT 008 / auxiliar sem Sefin/cert.
  // forcePdfRegen: regenera mesmo com pdf_storage_path (upgrade layout antigo → lib).
  if (doc.xml_storage_path && (!doc.pdf_storage_path || params.forcePdfRegen)) {
    nfseXmlBuf = await downloadNfseArtifact(doc.xml_storage_path);
    if (!nfseXmlBuf?.length) {
      throw new BillingNfseApproveError('XML NFS-e não encontrado no storage', {
        status: 404,
        code: 'NFSE_ARTIFACT_MISSING',
      });
    }
    const resolvedPdf = await resolveDanfsePdfBuffer({
      nfseXml: nfseXmlBuf,
      accessKey: doc.access_key,
    });
    if (!resolvedPdf?.pdf) {
      throw new BillingNfseApproveError(
        'Falha ao gerar DANFSe (lib / NT 008 / auxiliar) a partir do XML.',
        {
          status: 500,
          code: 'NFSE_LOCAL_PDF_FAILED',
        }
      );
    }
    const paths = await persistNfseDocumentArtifacts({
      workspaceId: params.workspaceId,
      documentId: params.documentId,
      danfsePdf: resolvedPdf.pdf,
    });
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (paths.pdf_storage_path) patch.pdf_storage_path = paths.pdf_storage_path;
    const { data: updated, error } = await supabase
      .from('billing_nfse_documents')
      .update(patch)
      .eq('id', params.documentId)
      .eq('workspace_id', params.workspaceId)
      .select('*')
      .maybeSingle();
    if (error) throw new BillingNfseApproveError(error.message, { status: 500 });
    return mapDocument((updated || { ...doc, ...patch }) as Record<string, unknown>);
  }

  // XML ausente: consulta Sefin (requer certificado + chave).
  if (!doc.access_key) {
    throw new BillingNfseApproveError('Documento sem chave de acesso para consulta Sefin', {
      status: 422,
      code: 'NFSE_NO_ACCESS_KEY',
    });
  }

  const entityType = doc.entity_type;
  const bundle = await loadIssuerBundle(params.workspaceId, entityType);
  const secretRef = bundle.secretRef || defaultSecretRefForEntity(entityType);
  if (!pfxFileExists(secretRef)) {
    throw new BillingNfseApproveError(`Certificado A1 ausente (${secretRef}) para backfill.`, {
      status: 422,
      code: BILLING_NFSE_AUDIT_CODES.CERT_MISSING,
    });
  }

  const password = resolvePfxPassword(secretRef);
  const material = loadPfxMaterial(secretRef, password);
  const client = new BillingNfseSefinClient({
    environment: resolveNfseEnvironment(bundle.issuer.environment),
    material,
  });

  const consult = await client.getNfseByChave(doc.access_key);
  nfseXmlGZipB64 = consult.nfseXmlGZipB64 || null;
  if (!nfseXmlGZipB64) {
    throw new BillingNfseApproveError('Sefin não retornou XML da NFS-e na consulta.', {
      status: 502,
      code: 'NFSE_CONSULT_NO_XML',
    });
  }
  try {
    nfseXmlBuf = decodeNfseXmlGzipB64(nfseXmlGZipB64);
  } catch {
    nfseXmlBuf = null;
  }

  if (!doc.pdf_storage_path) {
    try {
      const danfse = await client.getDanfsePdf(doc.access_key);
      if (danfse.ok && danfse.pdf) adnPdf = danfse.pdf;
    } catch {
      /* ADN DANFSe opcional (NT 008) */
    }
  }

  const resolvedPdf = !doc.pdf_storage_path
    ? await resolveDanfsePdfBuffer({
        adnPdf,
        nfseXml: nfseXmlBuf,
        accessKey: doc.access_key,
      })
    : null;

  const paths = await persistNfseDocumentArtifacts({
    workspaceId: params.workspaceId,
    documentId: params.documentId,
    nfseXmlGZipB64,
    nfseXmlBuffer: nfseXmlBuf,
    danfsePdf: resolvedPdf?.pdf ?? null,
  });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (paths.xml_storage_path) patch.xml_storage_path = paths.xml_storage_path;
  if (paths.pdf_storage_path) patch.pdf_storage_path = paths.pdf_storage_path;

  const { data: updated, error } = await supabase
    .from('billing_nfse_documents')
    .update(patch)
    .eq('id', params.documentId)
    .eq('workspace_id', params.workspaceId)
    .select('*')
    .maybeSingle();
  if (error) throw new BillingNfseApproveError(error.message, { status: 500 });
  return mapDocument((updated || doc) as Record<string, unknown>);
}

export type NfseDownloadKind = 'xml' | 'pdf' | 'dps';

export async function downloadNfseDocumentFile(params: {
  workspaceId: string;
  documentId: string;
  kind: NfseDownloadKind;
}): Promise<{ buffer: Buffer; contentType: string; filename: string; document: BillingNfseDocument }> {
  let doc = await loadNfseDocumentById(params.workspaceId, params.documentId);
  if (!doc) {
    throw new BillingNfseApproveError('Documento NFS-e não encontrado', {
      status: 404,
      code: 'NFSE_DOCUMENT_NOT_FOUND',
    });
  }

  if (params.kind === 'xml' || params.kind === 'pdf') {
    if (doc.status !== 'authorized' && doc.status !== 'canceled') {
      throw new BillingNfseApproveError('Download de XML/PDF só para NFS-e autorizada ou cancelada', {
        status: 422,
        code: 'NFSE_DOWNLOAD_STATUS',
      });
    }
    const needsXml = params.kind === 'xml' && !doc.xml_storage_path;
    // PDF: regenera (lib / NT 008) a partir do XML quando disponível.
    const needsPdf =
      params.kind === 'pdf' &&
      (!doc.pdf_storage_path || Boolean(doc.xml_storage_path));
    if (needsXml || (needsPdf && (doc.access_key || doc.xml_storage_path))) {
      try {
        doc = await backfillNfseDocumentArtifacts({
          workspaceId: params.workspaceId,
          documentId: params.documentId,
          forcePdfRegen: params.kind === 'pdf' && Boolean(doc.xml_storage_path),
        });
      } catch (err) {
        if (params.kind === 'xml') throw err;
        // PDF: se backfill falhar, cai no 404 abaixo
      }
    }
  }

  const path =
    params.kind === 'dps'
      ? doc.dps_xml_storage_path
      : params.kind === 'pdf'
        ? doc.pdf_storage_path
        : doc.xml_storage_path;

  if (!path) {
    throw new BillingNfseApproveError(
      params.kind === 'pdf'
        ? 'PDF DANFSe não disponível para este documento'
        : params.kind === 'dps'
          ? 'XML DPS não disponível para este documento'
          : 'XML NFS-e não disponível para este documento',
      { status: 404, code: 'NFSE_ARTIFACT_MISSING' }
    );
  }

  const buffer = await downloadNfseArtifact(path);
  if (!buffer) {
    throw new BillingNfseApproveError('Arquivo não encontrado no storage', {
      status: 404,
      code: 'NFSE_ARTIFACT_MISSING',
    });
  }

  const supabase = await getSupabase();
  const { data: inv } = await supabase
    .from('billing_invoices')
    .select(
      'entity_type, pharmacies(trade_name, legal_name, cnpj), billing_cycles(apuracao_start, apuracao_end)'
    )
    .eq('workspace_id', params.workspaceId)
    .eq('id', doc.invoice_id)
    .maybeSingle();
  const pharmacy = (inv?.pharmacies || null) as {
    trade_name?: string | null;
    legal_name?: string | null;
    cnpj?: string | null;
  } | null;
  const cycle = (inv?.billing_cycles || null) as {
    apuracao_start?: string | null;
    apuracao_end?: string | null;
  } | null;
  const entity = (String(inv?.entity_type || doc.entity_type) === 'coop' ? 'coop' : 'flux') as
    | 'coop'
    | 'flux';
  const docRef =
    doc.nfse_number ||
    doc.dps_number ||
    doc.access_key?.slice(0, 12) ||
    doc.id.slice(0, 8);
  const nameInput = {
    entity,
    pharmacyName: pharmacy?.trade_name || pharmacy?.legal_name || 'farmacia',
    cnpj: pharmacy?.cnpj,
    cycleStart: cycle?.apuracao_start,
    cycleEnd: cycle?.apuracao_end,
    docRef,
  };

  if (params.kind === 'pdf') {
    // Preferência de naming: DANFSe NT 008 (danfse); auxiliar só se gerador NT008 falhou na origem.
    return {
      buffer,
      contentType: 'application/pdf',
      filename: buildBillingArtifactFilename({ ...nameInput, tipo: 'danfse' }),
      document: doc,
    };
  }
  return {
    buffer,
    contentType: 'application/xml',
    filename: buildBillingArtifactFilename({
      ...nameInput,
      tipo: params.kind === 'dps' ? 'nfse-dps' : 'nfse-xml',
    }),
    document: doc,
  };
}

/**
 * Reemite NFS-e a partir de um documento rejeitado: cria nova tentativa e chama o emit engine.
 */
export async function reemitNfseDocument(params: {
  workspaceId: string;
  documentId: string;
  actorId: string;
}): Promise<{ previous: BillingNfseDocument; document: BillingNfseDocument; emit: EmitNfseResult }> {
  if (!isBillingNfseEnabled()) {
    throw new BillingNfseApproveError('NFS-e desabilitada (BILLING_NFSE_ENABLED).', {
      status: 422,
      code: 'NFSE_DISABLED',
    });
  }

  const supabase = await getSupabase();
  const previous = await loadNfseDocumentById(params.workspaceId, params.documentId);
  if (!previous) {
    throw new BillingNfseApproveError('Documento NFS-e não encontrado', {
      status: 404,
      code: 'NFSE_DOCUMENT_NOT_FOUND',
    });
  }
  if (!canReemitNfseDocument(previous.status)) {
    throw new BillingNfseApproveError(
      `Reemissão só permitida para status rejected ou canceled (atual: ${previous.status}).`,
      { status: 422, code: 'NFSE_REEMIT_STATUS' }
    );
  }

  const { data: invoice, error: invErr } = await supabase
    .from('billing_invoices')
    .select(
      'id, workspace_id, billing_cycle_id, pharmacy_id, entity_type, status, total_cents, revenue_line, billing_invoice_lines(metadata)'
    )
    .eq('workspace_id', params.workspaceId)
    .eq('id', previous.invoice_id)
    .maybeSingle();
  if (invErr) throw new BillingNfseApproveError(invErr.message, { status: 500 });
  if (!invoice) {
    throw new BillingNfseApproveError('Fatura não encontrada', { status: 404, code: 'INVOICE_NOT_FOUND' });
  }

  const entityType = invoice.entity_type as BillingNfseEntityType;
  const { data: pharmacy, error: phErr } = await supabase
    .from('pharmacies')
    .select(
      'id, trade_name, legal_name, cnpj, city, state, address_cep, address_street, address_number, address_neighborhood, ibge_city_code, municipal_registration'
    )
    .eq('id', invoice.pharmacy_id)
    .maybeSingle();
  if (phErr) throw new BillingNfseApproveError(phErr.message, { status: 500 });

  const gate = evaluateNfseTomadorGate(pharmacy);
  if (!gate.ok) {
    throw new BillingNfseApproveError(
      'Cadastro fiscal do tomador incompleto. Complete os dados da farmácia antes de reemitir.',
      {
        status: 422,
        code: NFSE_TOMADOR_INCOMPLETE_CODE,
        gaps: gate.gaps,
      }
    );
  }

  const revenueLine = resolveInvoiceRevenueLine({
    revenue_line: (invoice as { revenue_line?: unknown }).revenue_line,
    lines: ((invoice as { billing_invoice_lines?: Array<{ metadata?: Record<string, unknown> | null }> })
      .billing_invoice_lines || []) as Array<{ metadata?: Record<string, unknown> | null }>,
    fallback: previous.revenue_line,
  });
  const bundle = await loadIssuerBundle(params.workspaceId, entityType, revenueLine);
  if (!bundle.issuer.active) {
    throw new BillingNfseApproveError(`Emitente ${entityType} inativo.`, {
      status: 422,
      code: 'NFSE_ISSUER_INACTIVE',
    });
  }
  if (!bundle.profile) {
    throw new BillingNfseApproveError(`Perfil ${bundle.revenueLine} inativo para ${entityType}.`, {
      status: 422,
      code: 'NFSE_PROFILE_MISSING',
    });
  }

  const { data: legal } = await supabase
    .from('billing_legal_entities')
    .select('cnpj')
    .eq('workspace_id', params.workspaceId)
    .eq('entity_type', entityType)
    .maybeSingle();
  const legalCnpj = onlyDigits(String(legal?.cnpj || ''));
  if (legalCnpj.length !== 14) {
    throw new BillingNfseApproveError(`CNPJ do emitente ${entityType} inválido.`, {
      status: 422,
      code: 'NFSE_LEGAL_CNPJ',
    });
  }

  const { data: cycle } = await supabase
    .from('billing_cycles')
    .select('id, label, apuracao_start, apuracao_end')
    .eq('id', invoice.billing_cycle_id)
    .maybeSingle();

  const { data: prevDocs } = await supabase
    .from('billing_nfse_documents')
    .select('attempt_number')
    .eq('workspace_id', params.workspaceId)
    .eq('invoice_id', invoice.id)
    .order('attempt_number', { ascending: false })
    .limit(1);
  const attempt =
    (prevDocs?.[0]?.attempt_number != null ? Number(prevDocs[0].attempt_number) : previous.attempt_number) +
    1;

  const now = new Date().toISOString();
  const { data: docRow, error: docErr } = await supabase
    .from('billing_nfse_documents')
    .insert({
      workspace_id: params.workspaceId,
      invoice_id: invoice.id,
      issuer_config_id: bundle.issuer.id,
      entity_type: entityType,
      revenue_line: bundle.revenueLine,
      status: 'pending',
      attempt_number: attempt,
      updated_at: now,
    })
    .select('*')
    .single();
  if (docErr) throw new BillingNfseApproveError(docErr.message, { status: 500 });

  const document = mapDocument(docRow as Record<string, unknown>);

  await notify({
    workspaceId: params.workspaceId,
    billingCycleId: invoice.billing_cycle_id,
    pharmacyId: invoice.pharmacy_id,
    severity: 'info',
    code: BILLING_NFSE_AUDIT_CODES.REEMIT,
    title: 'NFS-e reemissão solicitada',
    message: `Nova tentativa ${attempt} a partir do documento rejeitado ${previous.id.slice(0, 8)}…`,
    metadata: {
      invoice_id: invoice.id,
      previous_document_id: previous.id,
      document_id: document.id,
      entity_type: entityType,
      revenue_line: bundle.revenueLine,
      attempt_number: attempt,
      actor_id: params.actorId,
    },
  }).catch(() => undefined);

  const emit = await tryEmitNfseDocument({
    workspaceId: params.workspaceId,
    documentId: document.id,
    invoice: {
      id: String(invoice.id),
      entity_type: entityType,
      total_cents: Number(invoice.total_cents) || 0,
      pharmacy_id: String(invoice.pharmacy_id),
      billing_cycle_id: String(invoice.billing_cycle_id),
    },
    pharmacy: (pharmacy || {}) as Record<string, unknown>,
    cycle: cycle || null,
    issuer: bundle.issuer,
    profile: bundle.profile,
    secretRef: bundle.secretRef || defaultSecretRefForEntity(entityType),
    legalEntityCnpj: legalCnpj,
  });

  return { previous, document: emit.document, emit };
}

export type CancelNfseResult = {
  document: BillingNfseDocument;
  canceled: boolean;
  protocol: string | null;
  error?: string;
};

/**
 * Cancela NFS-e autorizada via evento Sefin e101101 (POST /nfse/{chave}/eventos).
 * Homolog (producao_restrita): mesma flag BILLING_NFSE_ENABLED do emit; sem BILLING_NFSE_ALLOW_PRODUCAO.
 * Produção: exige BILLING_NFSE_ENABLED + BILLING_NFSE_ALLOW_PRODUCAO (hard-block de host).
 */
export async function cancelNfseDocument(params: {
  workspaceId: string;
  documentId: string;
  actorId: string;
  justificativa: string;
  codigoMotivo?: string | number;
  nPedReg?: number;
}): Promise<CancelNfseResult> {
  if (!isBillingNfseEnabled()) {
    throw new BillingNfseApproveError('NFS-e desabilitada (BILLING_NFSE_ENABLED).', {
      status: 422,
      code: 'NFSE_DISABLED',
    });
  }

  const supabase = await getSupabase();
  const doc = await loadNfseDocumentById(params.workspaceId, params.documentId);
  if (!doc) {
    throw new BillingNfseApproveError('Documento NFS-e não encontrado', {
      status: 404,
      code: 'NFSE_DOCUMENT_NOT_FOUND',
    });
  }
  if (!canCancelNfseDocument(doc.status)) {
    throw new BillingNfseApproveError(
      `Cancelamento só permitido para NFS-e autorizada (atual: ${doc.status}).`,
      { status: 422, code: 'NFSE_CANCEL_STATUS' }
    );
  }
  if (!doc.access_key) {
    throw new BillingNfseApproveError('Documento sem chave de acesso para cancelar na Sefin.', {
      status: 422,
      code: 'NFSE_NO_ACCESS_KEY',
    });
  }

  const entityType = doc.entity_type;
  const bundle = await loadIssuerBundle(params.workspaceId, entityType, doc.revenue_line);
  const secretRef = bundle.secretRef || defaultSecretRefForEntity(entityType);
  if (!pfxFileExists(secretRef)) {
    throw new BillingNfseApproveError(`Certificado A1 ausente (${secretRef}) para cancelar NFS-e.`, {
      status: 422,
      code: BILLING_NFSE_AUDIT_CODES.CERT_MISSING,
    });
  }

  const { data: legal } = await supabase
    .from('billing_legal_entities')
    .select('cnpj')
    .eq('workspace_id', params.workspaceId)
    .eq('entity_type', entityType)
    .maybeSingle();
  const legalCnpj = onlyDigits(String(legal?.cnpj || ''));
  if (legalCnpj.length !== 14) {
    throw new BillingNfseApproveError(`CNPJ do emitente ${entityType} inválido.`, {
      status: 422,
      code: 'NFSE_LEGAL_CNPJ',
    });
  }

  const { data: invoice } = await supabase
    .from('billing_invoices')
    .select('id, billing_cycle_id, pharmacy_id')
    .eq('workspace_id', params.workspaceId)
    .eq('id', doc.invoice_id)
    .maybeSingle();

  const environment = resolveNfseEnvironment(bundle.issuer.environment);
  const now = new Date().toISOString();

  let built;
  try {
    built = buildCancelEventXml({
      environment,
      autor_cnpj: legalCnpj,
      access_key: doc.access_key,
      justificativa: params.justificativa,
      codigo_motivo: params.codigoMotivo,
      n_ped_reg: params.nPedReg,
      dh_evento: now,
    });
  } catch (err) {
    const msg = safeErrorMessage(err);
    throw new BillingNfseApproveError(msg, { status: 400, code: 'NFSE_CANCEL_XML' });
  }

  const password = resolvePfxPassword(secretRef);
  const material = loadPfxMaterial(secretRef, password);
  const { signedXml, pedidoRegistroEventoXmlGZipB64 } = signPedRegEventoXmlToGzipBase64(
    built.xml,
    material
  );

  let client: BillingNfseSefinClient;
  try {
    client = new BillingNfseSefinClient({ environment, material });
  } catch (err) {
    const msg =
      err instanceof BillingNfseSefinClientError
        ? err.message
        : safeErrorMessage(err);
    throw new BillingNfseApproveError(msg, { status: 422, code: 'NFSE_SEFIN_ENV' });
  }

  let response;
  try {
    response = await client.postNfseEventoWithHttps(built.ch_nfse, pedidoRegistroEventoXmlGZipB64);
  } catch (err) {
    const msg = safeErrorMessage(err);
    const { data: failed } = await supabase
      .from('billing_nfse_documents')
      .update({ last_error: msg.slice(0, 500), updated_at: now })
      .eq('id', params.documentId)
      .eq('workspace_id', params.workspaceId)
      .select('*')
      .maybeSingle();

    await notify({
      workspaceId: params.workspaceId,
      billingCycleId: invoice?.billing_cycle_id || null,
      pharmacyId: invoice?.pharmacy_id || null,
      severity: 'critical',
      code: BILLING_NFSE_AUDIT_CODES.CANCEL_FAILED,
      title: 'Falha ao cancelar NFS-e na Sefin',
      message: msg.slice(0, 300),
      metadata: {
        invoice_id: doc.invoice_id,
        document_id: doc.id,
        entity_type: entityType,
        actor_id: params.actorId,
      },
    }).catch(() => undefined);

    return {
      document: mapDocument((failed || doc) as Record<string, unknown>),
      canceled: false,
      protocol: doc.protocol,
      error: msg,
    };
  }

  if (response.ok) {
    let cancelXml = signedXml;
    if (response.eventoXmlGZipB64) {
      try {
        cancelXml = decodeNfseXmlGzipB64(response.eventoXmlGZipB64).toString('utf8') || signedXml;
      } catch {
        cancelXml = signedXml;
      }
    }

    let xmlPathPatch: string | null = null;
    try {
      const stored = await persistNfseDocumentArtifacts({
        workspaceId: params.workspaceId,
        documentId: params.documentId,
        cancelEventXml: cancelXml,
        nfseXmlGZipB64: response.nfseXmlGZipB64 || null,
      });
      xmlPathPatch = stored.xml_storage_path;
    } catch (storageErr) {
      await notify({
        workspaceId: params.workspaceId,
        billingCycleId: invoice?.billing_cycle_id || null,
        pharmacyId: invoice?.pharmacy_id || null,
        severity: 'warning',
        code: BILLING_NFSE_AUDIT_CODES.CANCEL_FAILED,
        title: 'NFS-e cancelada na Sefin, falha ao persistir XML',
        message: safeErrorMessage(storageErr),
        metadata: {
          invoice_id: doc.invoice_id,
          document_id: doc.id,
          n_prot: response.nProt,
        },
      }).catch(() => undefined);
    }

    const protocol = response.nProt || response.idEvento || doc.protocol;
    const patch: Record<string, unknown> = {
      status: 'canceled',
      protocol,
      last_error: null,
      updated_at: now,
    };
    if (xmlPathPatch) patch.xml_storage_path = xmlPathPatch;

    const { data: updated, error: updErr } = await supabase
      .from('billing_nfse_documents')
      .update(patch)
      .eq('id', params.documentId)
      .eq('workspace_id', params.workspaceId)
      .eq('status', 'authorized')
      .select('*')
      .maybeSingle();
    if (updErr) throw new BillingNfseApproveError(updErr.message, { status: 500 });

    await notify({
      workspaceId: params.workspaceId,
      billingCycleId: invoice?.billing_cycle_id || null,
      pharmacyId: invoice?.pharmacy_id || null,
      severity: 'info',
      code: BILLING_NFSE_AUDIT_CODES.CANCELED,
      title: 'NFS-e cancelada',
      message: `Evento e101101 aceito pela Sefin (protocolo ${protocol || '—'}).`,
      metadata: {
        invoice_id: doc.invoice_id,
        document_id: doc.id,
        entity_type: entityType,
        chave_acesso: doc.access_key,
        n_prot: protocol,
        c_motivo: built.c_motivo,
        actor_id: params.actorId,
      },
    }).catch(() => undefined);

    return {
      document: mapDocument((updated || { ...doc, status: 'canceled', protocol }) as Record<string, unknown>),
      canceled: true,
      protocol: protocol || null,
    };
  }

  const errMsg =
    (response.erros || [])
      .map((e) => [e.codigo, e.descricao].filter(Boolean).join(' '))
      .filter(Boolean)
      .join('; ') || `Sefin HTTP ${response.status}`;

  try {
    await persistNfseDocumentArtifacts({
      workspaceId: params.workspaceId,
      documentId: params.documentId,
      cancelEventXml: signedXml,
    });
  } catch {
    /* auditoria best-effort */
  }

  const { data: rejected } = await supabase
    .from('billing_nfse_documents')
    .update({
      last_error: errMsg.slice(0, 500),
      updated_at: now,
    })
    .eq('id', params.documentId)
    .eq('workspace_id', params.workspaceId)
    .select('*')
    .maybeSingle();

  await notify({
    workspaceId: params.workspaceId,
    billingCycleId: invoice?.billing_cycle_id || null,
    pharmacyId: invoice?.pharmacy_id || null,
    severity: 'warning',
    code: BILLING_NFSE_AUDIT_CODES.CANCEL_FAILED,
    title: 'Sefin recusou cancelamento da NFS-e',
    message: errMsg.slice(0, 300),
    metadata: {
      invoice_id: doc.invoice_id,
      document_id: doc.id,
      entity_type: entityType,
      http_status: response.status,
      actor_id: params.actorId,
    },
  }).catch(() => undefined);

  return {
    document: mapDocument((rejected || doc) as Record<string, unknown>),
    canceled: false,
    protocol: doc.protocol,
    error: errMsg,
  };
}

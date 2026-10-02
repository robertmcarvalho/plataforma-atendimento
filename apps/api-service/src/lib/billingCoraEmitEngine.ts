/**
 * Emissão manual de boleto Cora a partir de fatura aprovada (MVP Flux).
 * Webhook de liquidação: TODO (stub).
 */

import { randomUUID } from 'node:crypto';
import {
  getCoraConfigForEntity,
  isBillingCoraEnabled,
  resolveEffectiveCoraClientId,
  BillingCoraConfigError,
} from './billingCoraConfig';
import { BillingCoraClient, BillingCoraClientError, mapCoraInvoiceStatusToBankSlip } from './billingCoraClient';
import { buildCoraInvoicePayload, BillingCoraBuilderError } from './billingCoraInvoiceBuilder';
import { loadCoraMtlsMaterial, BillingCoraSecretsError } from './billingCoraSecrets';
import {
  BillingBankSlipMirrorError,
  mirrorCoraBoletoPdfToStorage,
} from './billingBankSlipMirror';
import { downloadBankSlipPdf } from './billingBankSlipStorage';
import {
  buildBillingArtifactFilename,
  type BillingArtifactEntity,
} from './billingArtifactFilename';
import type { BillingBankSlip, BillingCoraEntityType } from './billingCoraTypes';

type SupabaseClient = typeof import('./supabase').supabase;

async function getSupabase(): Promise<SupabaseClient> {
  const mod = await import('./supabase');
  return mod.supabase;
}

export class BillingCoraEmitError extends Error {
  status: number;
  code?: string;
  gaps?: Array<{ code: string; label: string }>;
  constructor(message: string, status = 400, code?: string, gaps?: Array<{ code: string; label: string }>) {
    super(message);
    this.name = 'BillingCoraEmitError';
    this.status = status;
    this.code = code;
    this.gaps = gaps;
  }
}

function mapSlipRow(row: Record<string, unknown>): BillingBankSlip {
  return {
    id: String(row.id),
    workspace_id: String(row.workspace_id),
    invoice_id: String(row.invoice_id),
    entity_type: row.entity_type as BillingCoraEntityType,
    provider: 'cora',
    config_id: row.config_id != null ? String(row.config_id) : null,
    external_id: row.external_id != null ? String(row.external_id) : null,
    status: row.status as BillingBankSlip['status'],
    digitable_line: row.digitable_line != null ? String(row.digitable_line) : null,
    barcode: row.barcode != null ? String(row.barcode) : null,
    our_number: row.our_number != null ? String(row.our_number) : null,
    pdf_url: row.pdf_url != null ? String(row.pdf_url) : null,
    pdf_storage_path: row.pdf_storage_path != null ? String(row.pdf_storage_path) : null,
    amount_cents: Number(row.amount_cents) || 0,
    due_date: row.due_date != null ? String(row.due_date).slice(0, 10) : null,
    idempotency_key: String(row.idempotency_key),
    last_error: row.last_error != null ? String(row.last_error) : null,
    paid_at: row.paid_at != null ? String(row.paid_at) : null,
    created_at: row.created_at != null ? String(row.created_at) : undefined,
    updated_at: row.updated_at != null ? String(row.updated_at) : undefined,
  };
}

export async function loadLatestBankSlipsForInvoices(
  workspaceId: string,
  invoiceIds: string[]
): Promise<Map<string, BillingBankSlip>> {
  const map = new Map<string, BillingBankSlip>();
  if (!invoiceIds.length) return map;
  const supabase = await getSupabase();
  const { data, error } = await supabase
    .from('billing_bank_slips')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('invoice_id', invoiceIds)
    .order('created_at', { ascending: false });
  if (error) throw new BillingCoraEmitError(error.message, 500);
  for (const row of data || []) {
    const invId = String(row.invoice_id);
    if (!map.has(invId)) map.set(invId, mapSlipRow(row as Record<string, unknown>));
  }
  return map;
}

export type EmitCoraBankSlipResult = {
  bank_slip: BillingBankSlip;
  created: boolean;
};

/**
 * Emite boleto Cora para fatura Flux aprovada (ou reutiliza slip aberto existente).
 */
export async function emitCoraBankSlipForInvoice(params: {
  workspaceId: string;
  invoiceId: string;
  actorId?: string;
  forceNew?: boolean;
  /** Sobrescreve due_date da fatura no payload Cora (ex.: piloto com fatura vencida). */
  dueDateOverride?: string | null;
}): Promise<EmitCoraBankSlipResult> {
  if (!isBillingCoraEnabled()) {
    throw new BillingCoraEmitError(
      'Emissão Cora desabilitada (BILLING_CORA_ENABLED). Ative a flag após configurar Stage.',
      403,
      'cora_disabled'
    );
  }

  const supabase = await getSupabase();
  const { data: invoice, error: invErr } = await supabase
    .from('billing_invoices')
    .select(
      'id, workspace_id, entity_type, status, total_cents, due_date, pharmacy_id, billing_cycle_id, pharmacies(id, cnpj, legal_name, trade_name, billing_email, address_cep, address_street, address_number, address_neighborhood, city, state, ibge_city_code, municipal_registration), billing_cycles(id, label)'
    )
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.invoiceId)
    .maybeSingle();
  if (invErr) throw new BillingCoraEmitError(invErr.message, 500);
  if (!invoice) throw new BillingCoraEmitError('Fatura não encontrada', 404);

  const entityType = String(invoice.entity_type) as BillingCoraEntityType;
  if (entityType !== 'flux') {
    throw new BillingCoraEmitError(
      'MVP: boleto Cora disponível apenas para faturas Flux. Coop em rodada posterior.',
      400,
      'entity_not_supported'
    );
  }

  const status = String(invoice.status || '');
  if (status !== 'approved' && status !== 'sent') {
    throw new BillingCoraEmitError(
      'Emita boleto apenas para faturas aprovadas (ou enviadas).',
      400,
      'invoice_status'
    );
  }

  if (!params.forceNew) {
    const existing = await loadLatestBankSlipsForInvoices(params.workspaceId, [params.invoiceId]);
    const slip = existing.get(params.invoiceId);
    if (slip && (slip.status === 'open' || slip.status === 'paid') && slip.external_id) {
      return { bank_slip: slip, created: false };
    }
  }

  const config = await getCoraConfigForEntity(params.workspaceId, 'flux');
  if (!config || !config.enabled) {
    throw new BillingCoraEmitError(
      'Integração Cora Flux não está habilitada. Configure em /billing/config?tab=cora.',
      400,
      'config_disabled'
    );
  }

  const clientId = resolveEffectiveCoraClientId(config);
  if (!clientId) {
    throw new BillingCoraEmitError(
      'client_id Cora ausente. Informe nas configurações de faturamento (aba Cora / Boletos).',
      400,
      'missing_client_id'
    );
  }

  const secretRef = config.mtls_secret_ref || 'cora-flux-mtls';
  let material;
  try {
    material = loadCoraMtlsMaterial(secretRef);
  } catch (err) {
    if (err instanceof BillingCoraSecretsError) {
      throw new BillingCoraEmitError(err.message, err.status, 'missing_mtls');
    }
    throw err;
  }

  const pharmacyRaw = invoice.pharmacies as unknown;
  const pharmacy = (
    Array.isArray(pharmacyRaw) ? pharmacyRaw[0] || {} : pharmacyRaw || {}
  ) as Record<string, unknown>;
  const cycleRaw = invoice.billing_cycles as unknown;
  const cycle = (
    Array.isArray(cycleRaw) ? cycleRaw[0] || {} : cycleRaw || {}
  ) as { label?: string };
  let payload;
  try {
    const dueForCora =
      params.dueDateOverride != null && String(params.dueDateOverride).trim()
        ? String(params.dueDateOverride).trim().slice(0, 10)
        : invoice.due_date != null
          ? String(invoice.due_date)
          : null;
    payload = buildCoraInvoicePayload({
      invoiceId: String(invoice.id),
      totalCents: Number(invoice.total_cents) || 0,
      dueDate: dueForCora,
      pharmacy: {
        cnpj: pharmacy.cnpj as string | null,
        legal_name: pharmacy.legal_name as string | null,
        trade_name: pharmacy.trade_name as string | null,
        billing_email: pharmacy.billing_email as string | null,
        address_cep: pharmacy.address_cep as string | null,
        address_street: pharmacy.address_street as string | null,
        address_number: pharmacy.address_number as string | null,
        address_neighborhood: pharmacy.address_neighborhood as string | null,
        city: pharmacy.city as string | null,
        state: pharmacy.state as string | null,
        ibge_city_code: pharmacy.ibge_city_code as string | null,
        municipal_registration: pharmacy.municipal_registration as string | null,
      },
      cycleLabel: cycle.label || null,
      boletoTerms: {
        fine_mode: config.fine_mode,
        fine_rate: config.fine_rate,
        fine_amount_cents: config.fine_amount_cents,
        interest_rate: config.interest_rate,
        pix_qr_enabled: config.pix_qr_enabled,
        service_name_template: config.service_name_template,
        service_description_template: config.service_description_template,
      },
    });
  } catch (err) {
    if (err instanceof BillingCoraBuilderError) {
      throw new BillingCoraEmitError(err.message, err.status, 'builder', err.gaps);
    }
    throw err;
  }

  const idempotencyKey = randomUUID();
  const now = new Date().toISOString();
  const { data: pendingRow, error: pendingErr } = await supabase
    .from('billing_bank_slips')
    .insert({
      workspace_id: params.workspaceId,
      invoice_id: params.invoiceId,
      entity_type: entityType,
      provider: 'cora',
      config_id: config.id,
      status: 'pending',
      amount_cents: payload.services[0].amount,
      due_date: payload.payment_terms.due_date,
      idempotency_key: idempotencyKey,
      updated_at: now,
    })
    .select('*')
    .single();
  if (pendingErr) throw new BillingCoraEmitError(pendingErr.message, 500);

  const client = new BillingCoraClient({
    environment: config.environment,
    clientId,
    material,
  });

  try {
    const coraRes = await client.createInvoice(payload, idempotencyKey);
    const bankSlip = coraRes.payment_options?.bank_slip || {};
    const slipStatus = mapCoraInvoiceStatusToBankSlip(coraRes.status) as BillingBankSlip['status'];
    const { data: updated, error: updErr } = await supabase
      .from('billing_bank_slips')
      .update({
        external_id: coraRes.id,
        status: slipStatus === 'pending' ? 'open' : slipStatus,
        digitable_line: bankSlip.digitable || null,
        barcode: bankSlip.barcode || null,
        our_number: bankSlip.our_number || null,
        pdf_url: bankSlip.url || null,
        last_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', pendingRow.id)
      .eq('workspace_id', params.workspaceId)
      .select('*')
      .single();
    if (updErr) throw new BillingCoraEmitError(updErr.message, 500);

    let slip = mapSlipRow(updated as Record<string, unknown>);
    // Best-effort: espelha PDF no storage Aethera (falha não derruba a emissão).
    if (slip.pdf_url && !slip.pdf_storage_path) {
      try {
        const mirrored = await mirrorCoraBoletoPdfToStorage({
          workspaceId: params.workspaceId,
          bankSlipId: slip.id,
          pdfUrl: slip.pdf_url,
        });
        const { data: withPdf, error: pdfErr } = await supabase
          .from('billing_bank_slips')
          .update({
            pdf_storage_path: mirrored.pdf_storage_path,
            updated_at: new Date().toISOString(),
          })
          .eq('id', slip.id)
          .eq('workspace_id', params.workspaceId)
          .select('*')
          .single();
        if (!pdfErr && withPdf) slip = mapSlipRow(withPdf as Record<string, unknown>);
      } catch {
        /* mirror sob demanda no download */
      }
    }
    return { bank_slip: slip, created: true };
  } catch (err) {
    const message =
      err instanceof BillingCoraClientError || err instanceof BillingCoraConfigError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    await supabase
      .from('billing_bank_slips')
      .update({
        status: 'error',
        last_error: message.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq('id', pendingRow.id)
      .eq('workspace_id', params.workspaceId);
    if (err instanceof BillingCoraClientError) {
      throw new BillingCoraEmitError(message, err.status && err.status >= 400 ? err.status : 502, 'cora_api');
    }
    throw new BillingCoraEmitError(message, 502, 'cora_api');
  }
}

export type CancelCoraBankSlipResult = {
  bank_slip: BillingBankSlip;
  canceled: boolean;
};

/**
 * Cancela boleto aberto na Cora (DELETE /v2/invoices/{id}) e marca status local canceled.
 * Não cancela NFS-e nem altera a fatura.
 */
export async function cancelCoraBankSlip(params: {
  workspaceId: string;
  bankSlipId: string;
  actorId?: string;
}): Promise<CancelCoraBankSlipResult> {
  if (!isBillingCoraEnabled()) {
    throw new BillingCoraEmitError(
      'Cancelamento Cora desabilitado (BILLING_CORA_ENABLED).',
      403,
      'cora_disabled'
    );
  }

  const supabase = await getSupabase();
  const { data: slipRow, error: slipErr } = await supabase
    .from('billing_bank_slips')
    .select('*')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.bankSlipId)
    .maybeSingle();
  if (slipErr) throw new BillingCoraEmitError(slipErr.message, 500);
  if (!slipRow) throw new BillingCoraEmitError('Boleto não encontrado', 404);

  const slip = mapSlipRow(slipRow as Record<string, unknown>);
  if (slip.status === 'canceled') {
    return { bank_slip: slip, canceled: true };
  }
  if (slip.status === 'paid') {
    throw new BillingCoraEmitError(
      'Boleto já pago — não é possível cancelar na Cora.',
      422,
      'already_paid'
    );
  }
  if (slip.status !== 'open' && slip.status !== 'pending') {
    throw new BillingCoraEmitError(
      `Status local '${slip.status}' não permite cancelamento.`,
      400,
      'invalid_status'
    );
  }
  if (!slip.external_id) {
    throw new BillingCoraEmitError(
      'Boleto sem external_id Cora — não há o que cancelar na API.',
      400,
      'missing_external_id'
    );
  }
  if (slip.entity_type !== 'flux') {
    throw new BillingCoraEmitError(
      'MVP: cancelamento Cora apenas para boletos Flux.',
      400,
      'entity_not_supported'
    );
  }

  const config = await getCoraConfigForEntity(params.workspaceId, 'flux');
  if (!config || !config.enabled) {
    throw new BillingCoraEmitError(
      'Integração Cora Flux não está habilitada.',
      400,
      'config_disabled'
    );
  }
  const clientId = resolveEffectiveCoraClientId(config);
  if (!clientId) {
    throw new BillingCoraEmitError('client_id Cora ausente.', 400, 'missing_client_id');
  }

  const secretRef = config.mtls_secret_ref || 'cora-flux-mtls';
  let material;
  try {
    material = loadCoraMtlsMaterial(secretRef);
  } catch (err) {
    if (err instanceof BillingCoraSecretsError) {
      throw new BillingCoraEmitError(err.message, err.status, 'missing_mtls');
    }
    throw err;
  }

  const client = new BillingCoraClient({
    environment: config.environment,
    clientId,
    material,
  });

  try {
    await client.cancelInvoice(slip.external_id);
  } catch (err) {
    const message =
      err instanceof BillingCoraClientError
        ? err.message
        : err instanceof Error
          ? err.message
          : String(err);
    await supabase
      .from('billing_bank_slips')
      .update({
        last_error: message.slice(0, 2000),
        updated_at: new Date().toISOString(),
      })
      .eq('id', slip.id)
      .eq('workspace_id', params.workspaceId);
    if (err instanceof BillingCoraClientError) {
      throw new BillingCoraEmitError(
        message,
        err.status && err.status >= 400 ? err.status : 502,
        'cora_api'
      );
    }
    throw new BillingCoraEmitError(message, 502, 'cora_api');
  }

  const { data: updated, error: updErr } = await supabase
    .from('billing_bank_slips')
    .update({
      status: 'canceled',
      last_error: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', slip.id)
    .eq('workspace_id', params.workspaceId)
    .select('*')
    .single();
  if (updErr) throw new BillingCoraEmitError(updErr.message, 500);
  return { bank_slip: mapSlipRow(updated as Record<string, unknown>), canceled: true };
}

/**
 * Download do PDF do boleto a partir do storage Aethera.
 * Se ainda não espelhado, faz backfill a partir de pdf_url Cora.
 */
export async function downloadBankSlipPdfFile(params: {
  workspaceId: string;
  bankSlipId: string;
}): Promise<{
  buffer: Buffer;
  contentType: string;
  filename: string;
  bank_slip: BillingBankSlip;
}> {
  const supabase = await getSupabase();
  const { data: slipRow, error: slipErr } = await supabase
    .from('billing_bank_slips')
    .select('*')
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.bankSlipId)
    .maybeSingle();
  if (slipErr) throw new BillingCoraEmitError(slipErr.message, 500);
  if (!slipRow) throw new BillingCoraEmitError('Boleto não encontrado', 404);

  let slip = mapSlipRow(slipRow as Record<string, unknown>);

  if (!slip.pdf_storage_path) {
    try {
      const mirrored = await mirrorCoraBoletoPdfToStorage({
        workspaceId: params.workspaceId,
        bankSlipId: slip.id,
        pdfUrl: slip.pdf_url,
        existingStoragePath: slip.pdf_storage_path,
      });
      const { data: updated, error: updErr } = await supabase
        .from('billing_bank_slips')
        .update({
          pdf_storage_path: mirrored.pdf_storage_path,
          updated_at: new Date().toISOString(),
        })
        .eq('id', slip.id)
        .eq('workspace_id', params.workspaceId)
        .select('*')
        .single();
      if (updErr) throw new BillingCoraEmitError(updErr.message, 500);
      slip = mapSlipRow(updated as Record<string, unknown>);
    } catch (err) {
      if (err instanceof BillingBankSlipMirrorError) {
        throw new BillingCoraEmitError(err.message, err.status, err.code);
      }
      throw err;
    }
  }

  if (!slip.pdf_storage_path) {
    throw new BillingCoraEmitError('PDF do boleto não disponível no storage', 404, 'missing_pdf');
  }

  const buffer = await downloadBankSlipPdf(slip.pdf_storage_path);
  if (!buffer) {
    throw new BillingCoraEmitError('Arquivo do boleto não encontrado no storage', 404, 'missing_pdf');
  }

  const { data: inv } = await supabase
    .from('billing_invoices')
    .select(
      'id, entity_type, pharmacies(trade_name, legal_name, cnpj), billing_cycles(apuracao_start, apuracao_end)'
    )
    .eq('workspace_id', params.workspaceId)
    .eq('id', slip.invoice_id)
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
  const entity = (String(inv?.entity_type || slip.entity_type) === 'coop' ? 'coop' : 'flux') as BillingArtifactEntity;
  const docRef = slip.external_id || slip.our_number || slip.id.slice(0, 8);
  const filename = buildBillingArtifactFilename({
    entity,
    pharmacyName: pharmacy?.trade_name || pharmacy?.legal_name || 'farmacia',
    cnpj: pharmacy?.cnpj,
    cycleStart: cycle?.apuracao_start,
    cycleEnd: cycle?.apuracao_end,
    tipo: 'boleto',
    docRef,
  });

  return {
    buffer,
    contentType: 'application/pdf',
    filename,
    bank_slip: slip,
  };
}

/**
 * Stub — webhook invoice.paid (fase posterior).
 * Não processa eventos ainda.
 */
export async function handleCoraInvoicePaidWebhookStub(_params: {
  workspaceId?: string;
  resourceId?: string | null;
  eventId?: string | null;
}): Promise<{ ok: false; todo: true; message: string }> {
  return {
    ok: false,
    todo: true,
    message:
      'Webhook Cora de liquidação ainda não implementado. Baixa manual em /billing/receber ou evoluir fase 4.',
  };
}

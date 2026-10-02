/**
 * Envio manual do pacote da fatura por e-mail.
 * Anexos: boleto PDF + DANFSe PDF + XML NFS-e.
 * Corpo: link HTML público (sem PDF de relatório).
 * Destinatário: pharmacies.billing_email ?? pharmacies.email.
 *
 * @see reports/billing-documentos-pdf-email-parecer-2026-09-08.md
 */

import {
  listInvoiceDocumentArtifacts,
  type InvoiceArtifactKind,
  type InvoiceArtifactsPackage,
} from './billingInvoiceArtifacts';
import { downloadNfseArtifact } from './billingNfseStorage';
import { downloadBankSlipPdf } from './billingBankSlipStorage';
import { mirrorCoraBoletoPdfToStorage } from './billingBankSlipMirror';
import { backfillNfseDocumentArtifacts, loadLatestNfseDocumentsForInvoices } from './billingNfseEmitEngine';
import { loadLatestBankSlipsForInvoices } from './billingCoraEmitEngine';
import { buildBillingArtifactFilename } from './billingArtifactFilename';
import { buildInvoicePackageEmailBody } from './billingInvoicePackageEmailBody';

export { buildInvoicePackageEmailBody } from './billingInvoicePackageEmailBody';

type SupabaseClient = typeof import('./supabase').supabase;

async function getSupabase(): Promise<SupabaseClient> {
  const mod = await import('./supabase');
  return mod.supabase;
}

export class BillingInvoiceEmailError extends Error {
  status: number;
  code?: string;
  missing?: InvoiceArtifactKind[];
  constructor(message: string, status = 400, code?: string, missing?: InvoiceArtifactKind[]) {
    super(message);
    this.name = 'BillingInvoiceEmailError';
    this.status = status;
    this.code = code;
    this.missing = missing;
  }
}

export type SendInvoicePackageEmailResult = {
  ok: true;
  dry_run: boolean;
  to: string;
  subject: string;
  invoice_id: string;
  attachments: Array<{ kind: string; filename: string; bytes: number }>;
  invoice_html_url: string | null;
  package: InvoiceArtifactsPackage;
  /** Só em dry_run: não enviou SMTP. */
  note?: string;
};

/**
 * Tenta espelhar boleto / regenerar DANFSe (lib portal-patched) antes do gate.
 */
async function prepareArtifactsForEmail(params: {
  workspaceId: string;
  invoiceId: string;
}): Promise<InvoiceArtifactsPackage> {
  const supabase = await getSupabase();
  const [slipMap, nfseMap] = await Promise.all([
    loadLatestBankSlipsForInvoices(params.workspaceId, [params.invoiceId]),
    loadLatestNfseDocumentsForInvoices(params.workspaceId, [params.invoiceId]),
  ]);
  const slip = slipMap.get(params.invoiceId) || null;
  const nfse = nfseMap.get(params.invoiceId) || null;

  if (slip && !slip.pdf_storage_path && slip.pdf_url) {
    try {
      const mirrored = await mirrorCoraBoletoPdfToStorage({
        workspaceId: params.workspaceId,
        bankSlipId: slip.id,
        pdfUrl: slip.pdf_url,
        existingStoragePath: slip.pdf_storage_path,
      });
      await supabase
        .from('billing_bank_slips')
        .update({
          pdf_storage_path: mirrored.pdf_storage_path,
          updated_at: new Date().toISOString(),
        })
        .eq('id', slip.id)
        .eq('workspace_id', params.workspaceId);
    } catch {
      /* gate abaixo reporta missing */
    }
  }

  if (nfse && nfse.status === 'authorized' && nfse.xml_storage_path) {
    try {
      await backfillNfseDocumentArtifacts({
        workspaceId: params.workspaceId,
        documentId: nfse.id,
        forcePdfRegen: true,
      });
    } catch {
      /* gate abaixo */
    }
  }

  return listInvoiceDocumentArtifacts(params);
}

/**
 * Monta e envia (ou dry-run) o pacote da fatura.
 */
export async function sendInvoiceDocumentPackageEmail(params: {
  workspaceId: string;
  invoiceId: string;
  /** Override do destinatário (ex.: e-mail de teste). */
  toOverride?: string | null;
  /** Se true, monta anexos e loga sem SMTP. */
  dryRun?: boolean;
}): Promise<SendInvoicePackageEmailResult> {
  const supabase = await getSupabase();
  const pack = await prepareArtifactsForEmail({
    workspaceId: params.workspaceId,
    invoiceId: params.invoiceId,
  });

  const to = String(params.toOverride || pack.pharmacy_email || '').trim();
  if (!to) {
    throw new BillingInvoiceEmailError(
      'Farmácia sem e-mail de faturamento (billing_email / email).',
      422,
      'missing_recipient'
    );
  }

  if (!pack.package_ready) {
    const labels: Record<InvoiceArtifactKind, string> = {
      boleto_pdf: 'boleto PDF',
      nfse_xml: 'XML NFS-e',
      nfse_danfse: 'DANFSe PDF',
      invoice_html_url: 'link HTML da fatura',
    };
    const missingLabel = pack.missing.map((k) => labels[k] || k).join(', ');
    throw new BillingInvoiceEmailError(
      `Pacote incompleto — faltando: ${missingLabel}. Emita boleto/NFS-e e baixe o PDF se necessário.`,
      422,
      'package_incomplete',
      pack.missing
    );
  }

  const { data: inv } = await supabase
    .from('billing_invoices')
    .select(
      'id, entity_type, pharmacies(trade_name, legal_name, cnpj), billing_cycles(label, apuracao_start, apuracao_end)'
    )
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.invoiceId)
    .maybeSingle();

  const pharmacy = (inv?.pharmacies || null) as {
    trade_name?: string | null;
    legal_name?: string | null;
    cnpj?: string | null;
  } | null;
  const cycle = (inv?.billing_cycles || null) as {
    label?: string | null;
    apuracao_start?: string | null;
    apuracao_end?: string | null;
  } | null;
  const pharmacyName = pharmacy?.trade_name || pharmacy?.legal_name || 'Farmácia';
  const entity = (String(inv?.entity_type) === 'coop' ? 'coop' : 'flux') as 'coop' | 'flux';
  const entityLabel = entity === 'coop' ? 'CoopMob' : 'Flux Farma';
  const htmlUrl = pack.artifacts.find((a) => a.kind === 'invoice_html_url')?.url || null;
  if (!htmlUrl) {
    throw new BillingInvoiceEmailError('Fatura sem link HTML público.', 422, 'missing_html_url');
  }

  const nameBase = {
    entity,
    pharmacyName,
    cnpj: pharmacy?.cnpj,
    cycleStart: cycle?.apuracao_start,
    cycleEnd: cycle?.apuracao_end,
  };

  const boletoArt = pack.artifacts.find((a) => a.kind === 'boleto_pdf');
  const danfseArt = pack.artifacts.find((a) => a.kind === 'nfse_danfse');
  const xmlArt = pack.artifacts.find((a) => a.kind === 'nfse_xml');

  const boletoBuf = boletoArt?.storage_path
    ? await downloadBankSlipPdf(boletoArt.storage_path)
    : null;
  const danfseBuf = danfseArt?.storage_path
    ? await downloadNfseArtifact(danfseArt.storage_path)
    : null;
  const xmlBuf = xmlArt?.storage_path ? await downloadNfseArtifact(xmlArt.storage_path) : null;

  if (!boletoBuf?.length || !danfseBuf?.length || !xmlBuf?.length) {
    throw new BillingInvoiceEmailError(
      'Falha ao ler anexos do storage (boleto / DANFSe / XML).',
      500,
      'storage_read_failed'
    );
  }

  const nfseMap = await loadLatestNfseDocumentsForInvoices(params.workspaceId, [params.invoiceId]);
  const nfse = nfseMap.get(params.invoiceId);
  const docRef =
    nfse?.nfse_number || nfse?.dps_number || nfse?.access_key?.slice(0, 12) || params.invoiceId.slice(0, 8);

  const attachments = [
    {
      kind: 'boleto_pdf',
      filename: buildBillingArtifactFilename({ ...nameBase, tipo: 'boleto', docRef: params.invoiceId.slice(0, 8) }),
      content: boletoBuf,
      contentType: 'application/pdf',
    },
    {
      kind: 'nfse_danfse',
      filename: buildBillingArtifactFilename({ ...nameBase, tipo: 'danfse', docRef }),
      content: danfseBuf,
      contentType: 'application/pdf',
    },
    {
      kind: 'nfse_xml',
      filename: buildBillingArtifactFilename({ ...nameBase, tipo: 'nfse-xml', docRef }),
      content: xmlBuf,
      contentType: 'application/xml',
    },
  ];

  const body = buildInvoicePackageEmailBody({
    pharmacyName,
    cycleLabel: cycle?.label || null,
    invoiceHtmlUrl: htmlUrl,
    entityLabel,
  });

  const attachmentMeta = attachments.map((a) => ({
    kind: a.kind,
    filename: a.filename,
    bytes: a.content.length,
  }));

  if (params.dryRun) {
    return {
      ok: true,
      dry_run: true,
      to,
      subject: body.subject,
      invoice_id: params.invoiceId,
      attachments: attachmentMeta,
      invoice_html_url: htmlUrl,
      package: pack,
      note: 'Dry-run: anexos montados; SMTP não chamado. Remova dry_run / use a UI sem modo teste para enviar.',
    };
  }

  const channelOpts = await (
    await import('./emailSender')
  ).workspaceEmailChannelSendOpts(params.workspaceId);
  const { sendTransactionalEmail } = await import('./emailSender');
  await sendTransactionalEmail({
    to,
    subject: body.subject,
    html: body.html,
    text: body.text,
    workspaceId: params.workspaceId,
    templateKey: 'billing_invoice_package',
    attachments: attachments.map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    })),
    ...channelOpts,
  });

  return {
    ok: true,
    dry_run: false,
    to,
    subject: body.subject,
    invoice_id: params.invoiceId,
    attachments: attachmentMeta,
    invoice_html_url: htmlUrl,
    package: pack,
  };
}

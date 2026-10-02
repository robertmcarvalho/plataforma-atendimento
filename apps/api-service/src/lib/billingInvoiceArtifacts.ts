/**
 * Lista artefatos “ready” do pacote da fatura (base para e-mail futuro).
 * Pacote revisado 2026-09-08: boleto PDF + DANFSe + XML + link HTML (sem PDF de relatório).
 */

import { resolveWebAppBaseUrl } from './webAppUrl';
import { loadLatestBankSlipsForInvoices } from './billingCoraEmitEngine';
import { loadLatestNfseDocumentsForInvoices } from './billingNfseEmitEngine';

type SupabaseClient = typeof import('./supabase').supabase;

async function getSupabase(): Promise<SupabaseClient> {
  const mod = await import('./supabase');
  return mod.supabase;
}

export type InvoiceArtifactKind =
  | 'boleto_pdf'
  | 'nfse_xml'
  | 'nfse_danfse'
  | 'invoice_html_url';

export type InvoiceArtifactStatus = 'ready' | 'pending' | 'missing';

export type InvoiceArtifactItem = {
  kind: InvoiceArtifactKind;
  status: InvoiceArtifactStatus;
  /** Pronto para anexo (bytes no storage Aethera). */
  ready: boolean;
  source?: string | null;
  storage_path?: string | null;
  /** URL externa (Cora) — fallback se mirror ainda não rodou. */
  external_url?: string | null;
  /** URL HTML pública da fatura (não é anexo). */
  url?: string | null;
  note?: string | null;
};

export type InvoiceArtifactsPackage = {
  invoice_id: string;
  pharmacy_id: string | null;
  /** Destinatário sugerido: billing_email ?? email do cadastro. */
  pharmacy_email: string | null;
  billing_email: string | null;
  email: string | null;
  public_token: string | null;
  artifacts: InvoiceArtifactItem[];
  /** Gate do pacote de e-mail (sem PDF de relatório). */
  package_ready: boolean;
  missing: InvoiceArtifactKind[];
};

function publicInvoiceHtmlUrl(publicToken: string | null | undefined): string | null {
  const token = String(publicToken || '').trim();
  if (!token) return null;
  return `${resolveWebAppBaseUrl()}/public/billing/${encodeURIComponent(token)}`;
}

/**
 * Resolve artefatos do pacote para uma fatura (view financeiro).
 */
export async function listInvoiceDocumentArtifacts(params: {
  workspaceId: string;
  invoiceId: string;
}): Promise<InvoiceArtifactsPackage> {
  const supabase = await getSupabase();
  const { data: inv, error } = await supabase
    .from('billing_invoices')
    .select(
      'id, pharmacy_id, public_token, pharmacies(id, email, billing_email)'
    )
    .eq('workspace_id', params.workspaceId)
    .eq('id', params.invoiceId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!inv) throw Object.assign(new Error('Fatura não encontrada'), { status: 404 });

  const pharmacy = (inv.pharmacies || null) as {
    id?: string;
    email?: string | null;
    billing_email?: string | null;
  } | null;
  const billingEmail = pharmacy?.billing_email ? String(pharmacy.billing_email).trim() : null;
  const email = pharmacy?.email ? String(pharmacy.email).trim() : null;
  const pharmacyEmail = billingEmail || email || null;

  const [slipMap, nfseMap] = await Promise.all([
    loadLatestBankSlipsForInvoices(params.workspaceId, [params.invoiceId]),
    loadLatestNfseDocumentsForInvoices(params.workspaceId, [params.invoiceId]),
  ]);
  const slip = slipMap.get(params.invoiceId) || null;
  const nfse = nfseMap.get(params.invoiceId) || null;

  const htmlUrl = publicInvoiceHtmlUrl(inv.public_token as string | null);

  const boleto: InvoiceArtifactItem = (() => {
    if (!slip) {
      return {
        kind: 'boleto_pdf',
        status: 'missing',
        ready: false,
        note: 'Boleto não emitido',
      };
    }
    if (slip.pdf_storage_path) {
      return {
        kind: 'boleto_pdf',
        status: 'ready',
        ready: true,
        source: 'aethera_mirror',
        storage_path: slip.pdf_storage_path,
        external_url: slip.pdf_url,
      };
    }
    if (slip.pdf_url) {
      return {
        kind: 'boleto_pdf',
        status: 'pending',
        ready: false,
        source: 'cora_url',
        external_url: slip.pdf_url,
        note: 'PDF Cora disponível; mirror Aethera pendente (download fará backfill)',
      };
    }
    return {
      kind: 'boleto_pdf',
      status: 'pending',
      ready: false,
      note: `Boleto status=${slip.status} sem PDF`,
    };
  })();

  const nfseXml: InvoiceArtifactItem = (() => {
    if (!nfse || nfse.status !== 'authorized') {
      return {
        kind: 'nfse_xml',
        status: nfse ? 'pending' : 'missing',
        ready: false,
        note: nfse ? `NFS-e status=${nfse.status}` : 'NFS-e não emitida',
      };
    }
    if (nfse.xml_storage_path) {
      return {
        kind: 'nfse_xml',
        status: 'ready',
        ready: true,
        source: 'aethera',
        storage_path: nfse.xml_storage_path,
      };
    }
    return {
      kind: 'nfse_xml',
      status: 'pending',
      ready: false,
      note: 'Autorizada sem xml_storage_path',
    };
  })();

  const danfse: InvoiceArtifactItem = (() => {
    if (!nfse || nfse.status !== 'authorized') {
      return {
        kind: 'nfse_danfse',
        status: nfse ? 'pending' : 'missing',
        ready: false,
        note: nfse ? `NFS-e status=${nfse.status}` : 'NFS-e não emitida',
      };
    }
    if (nfse.pdf_storage_path) {
      return {
        kind: 'nfse_danfse',
        status: 'ready',
        ready: true,
        source: 'storage',
        storage_path: nfse.pdf_storage_path,
        note: 'PDF no storage (preferência: NT 008 regenerado no download/backfill; aux/ADN se fallback).',
      };
    }
    return {
      kind: 'nfse_danfse',
      status: 'pending',
      ready: false,
      note: 'Sem pdf_storage_path (gerar aux ou NT 008)',
    };
  })();

  const invoiceHtml: InvoiceArtifactItem = htmlUrl
    ? {
        kind: 'invoice_html_url',
        status: 'ready',
        ready: true,
        url: htmlUrl,
        note: 'Link HTML público — não é anexo PDF',
      }
    : {
        kind: 'invoice_html_url',
        status: 'missing',
        ready: false,
        note: 'Fatura sem public_token',
      };

  const artifacts = [boleto, nfseXml, danfse, invoiceHtml];
  const required: InvoiceArtifactKind[] = [
    'boleto_pdf',
    'nfse_xml',
    'nfse_danfse',
    'invoice_html_url',
  ];
  const missing = required.filter((k) => !artifacts.find((a) => a.kind === k)?.ready);
  return {
    invoice_id: params.invoiceId,
    pharmacy_id: inv.pharmacy_id != null ? String(inv.pharmacy_id) : null,
    pharmacy_email: pharmacyEmail,
    billing_email: billingEmail,
    email,
    public_token: inv.public_token != null ? String(inv.public_token) : null,
    artifacts,
    package_ready: missing.length === 0,
    missing,
  };
}

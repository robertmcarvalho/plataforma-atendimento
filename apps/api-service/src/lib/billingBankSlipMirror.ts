/**
 * Espelha o PDF do boleto Cora (pdf_url) no storage Aethera.
 * Usado na emissão e em backfill sob demanda no download.
 */

import {
  bankSlipStoragePaths,
  downloadBankSlipPdf,
  uploadBankSlipPdf,
} from './billingBankSlipStorage';

export class BillingBankSlipMirrorError extends Error {
  status: number;
  code?: string;
  constructor(message: string, status = 400, code?: string) {
    super(message);
    this.name = 'BillingBankSlipMirrorError';
    this.status = status;
    this.code = code;
  }
}

export type FetchPdfFn = (url: string) => Promise<Buffer>;

/** GET da URL pública do PDF Cora (sem auth). Injetável em testes. */
export async function fetchCoraBoletoPdfBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url, {
    method: 'GET',
    headers: { Accept: 'application/pdf,*/*' },
    redirect: 'follow',
  });
  if (!res.ok) {
    throw new BillingBankSlipMirrorError(
      `Falha ao baixar PDF Cora (HTTP ${res.status})`,
      502,
      'cora_pdf_fetch_failed'
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) {
    throw new BillingBankSlipMirrorError('PDF Cora vazio', 502, 'cora_pdf_empty');
  }
  // %PDF
  if (buf[0] !== 0x25 || buf[1] !== 0x50 || buf[2] !== 0x44 || buf[3] !== 0x46) {
    throw new BillingBankSlipMirrorError(
      'Resposta Cora não parece PDF',
      502,
      'cora_pdf_invalid'
    );
  }
  return buf;
}

export type MirrorBoletoPdfResult = {
  pdf_storage_path: string;
  mirrored: boolean;
  bytes: number;
};

/**
 * Se já há path local, não rebaixa. Senão: fetch pdf_url → upload → devolve path.
 */
export async function mirrorCoraBoletoPdfToStorage(params: {
  workspaceId: string;
  bankSlipId: string;
  pdfUrl: string | null | undefined;
  existingStoragePath?: string | null;
  fetchPdf?: FetchPdfFn;
  /** Injetável em testes. */
  uploadPdf?: (path: string, buffer: Buffer) => Promise<void>;
  downloadPdf?: (path: string) => Promise<Buffer | null>;
}): Promise<MirrorBoletoPdfResult> {
  const paths = bankSlipStoragePaths(params.workspaceId, params.bankSlipId);
  const downloadPdf = params.downloadPdf || downloadBankSlipPdf;
  const uploadPdf = params.uploadPdf || uploadBankSlipPdf;
  const existing = String(params.existingStoragePath || '').trim();
  if (existing) {
    const cached = await downloadPdf(existing);
    if (cached && cached.length) {
      return { pdf_storage_path: existing, mirrored: false, bytes: cached.length };
    }
  }

  const url = String(params.pdfUrl || '').trim();
  if (!url) {
    throw new BillingBankSlipMirrorError(
      'Boleto sem pdf_url Cora — não é possível espelhar',
      404,
      'missing_pdf_url'
    );
  }

  const fetchPdf = params.fetchPdf || fetchCoraBoletoPdfBuffer;
  const buffer = await fetchPdf(url);
  if (!buffer.length) {
    throw new BillingBankSlipMirrorError('PDF Cora vazio', 502, 'cora_pdf_empty');
  }
  if (buffer[0] !== 0x25 || buffer[1] !== 0x50 || buffer[2] !== 0x44 || buffer[3] !== 0x46) {
    throw new BillingBankSlipMirrorError(
      'Resposta Cora não parece PDF',
      502,
      'cora_pdf_invalid'
    );
  }
  await uploadPdf(paths.boletoPdf, buffer);
  return {
    pdf_storage_path: paths.boletoPdf,
    mirrored: true,
    bytes: buffer.length,
  };
}

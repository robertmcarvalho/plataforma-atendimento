/**
 * Storage privado de artefatos NFS-e (DPS XML, NFS-e XML, DANFSe PDF).
 * Padrão: commercial/proposalStorage — bucket privado + ensureBucket.
 */

import { gunzipSync } from 'node:zlib';

export const BILLING_NFSE_BUCKET = 'billing-nfse';

type SupabaseClient = typeof import('./supabase').supabase;

let bucketReady = false;

async function getSupabase(): Promise<SupabaseClient> {
  const mod = await import('./supabase');
  return mod.supabase;
}

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const supabase = await getSupabase();
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BILLING_NFSE_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BILLING_NFSE_BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
    });
    if (error && !error.message.includes('already exists')) {
      throw new Error(`Storage bucket billing-nfse: ${error.message}`);
    }
  }
  bucketReady = true;
}

/** Paths canônicos por documento (workspace/docId/…). */
export function nfseStoragePaths(workspaceId: string, documentId: string) {
  const base = `${workspaceId}/${documentId}`;
  return {
    dpsXml: `${base}/dps.xml`,
    nfseXml: `${base}/nfse.xml`,
    danfsePdf: `${base}/danfse.pdf`,
    cancelEventXml: `${base}/evento-cancelamento.xml`,
  };
}

export function decodeNfseXmlGzipB64(nfseXmlGZipB64: string): Buffer {
  const raw = Buffer.from(String(nfseXmlGZipB64 || ''), 'base64');
  if (!raw.length) throw new Error('nfseXmlGZipB64 vazio');
  // gzip magic 1f 8b — se já for XML plain, devolve como está
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    return gunzipSync(raw);
  }
  const asText = raw.toString('utf8').trim();
  if (asText.startsWith('<')) return raw;
  return gunzipSync(raw);
}

export async function uploadNfseArtifact(
  path: string,
  buffer: Buffer,
  contentType: string
): Promise<void> {
  await ensureBucket();
  const supabase = await getSupabase();
  const { error } = await supabase.storage.from(BILLING_NFSE_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Upload NFS-e (${path}): ${error.message}`);
}

export async function downloadNfseArtifact(path: string): Promise<Buffer | null> {
  await ensureBucket();
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage.from(BILLING_NFSE_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

export type PersistNfseArtifactsInput = {
  workspaceId: string;
  documentId: string;
  dpsXml?: string | null;
  nfseXmlBuffer?: Buffer | null;
  nfseXmlGZipB64?: string | null;
  danfsePdf?: Buffer | null;
  /** XML assinado do pedRegEvento e101101 (e/ou retorno Sefin). */
  cancelEventXml?: string | null;
};

export type PersistNfseArtifactsResult = {
  dps_xml_storage_path: string | null;
  xml_storage_path: string | null;
  pdf_storage_path: string | null;
  cancel_event_xml_storage_path: string | null;
};

/** Persiste artefatos disponíveis e devolve paths para gravar em billing_nfse_documents. */
export async function persistNfseDocumentArtifacts(
  input: PersistNfseArtifactsInput
): Promise<PersistNfseArtifactsResult> {
  const paths = nfseStoragePaths(input.workspaceId, input.documentId);
  let dpsPath: string | null = null;
  let xmlPath: string | null = null;
  let pdfPath: string | null = null;
  let cancelPath: string | null = null;

  if (input.dpsXml && String(input.dpsXml).trim()) {
    await uploadNfseArtifact(paths.dpsXml, Buffer.from(input.dpsXml, 'utf8'), 'application/xml');
    dpsPath = paths.dpsXml;
  }

  let nfseBuf = input.nfseXmlBuffer || null;
  if (!nfseBuf && input.nfseXmlGZipB64) {
    nfseBuf = decodeNfseXmlGzipB64(input.nfseXmlGZipB64);
  }
  if (nfseBuf && nfseBuf.length) {
    await uploadNfseArtifact(paths.nfseXml, nfseBuf, 'application/xml');
    xmlPath = paths.nfseXml;
  }

  if (input.danfsePdf && input.danfsePdf.length) {
    await uploadNfseArtifact(paths.danfsePdf, input.danfsePdf, 'application/pdf');
    pdfPath = paths.danfsePdf;
  }

  if (input.cancelEventXml && String(input.cancelEventXml).trim()) {
    await uploadNfseArtifact(
      paths.cancelEventXml,
      Buffer.from(input.cancelEventXml, 'utf8'),
      'application/xml'
    );
    cancelPath = paths.cancelEventXml;
  }

  return {
    dps_xml_storage_path: dpsPath,
    xml_storage_path: xmlPath,
    pdf_storage_path: pdfPath,
    cancel_event_xml_storage_path: cancelPath,
  };
}

/** Reset interno de testes unitários. */
export function __resetBillingNfseBucketCacheForTests(): void {
  bucketReady = false;
}

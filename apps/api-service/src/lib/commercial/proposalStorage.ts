import { supabase } from '../supabase';

export const COMMERCIAL_PROPOSALS_BUCKET = 'commercial-proposals';

let bucketReady = false;

async function ensureBucket(): Promise<void> {
  if (bucketReady) return;
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === COMMERCIAL_PROPOSALS_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(COMMERCIAL_PROPOSALS_BUCKET, {
      public: false,
      fileSizeLimit: 25 * 1024 * 1024,
    });
    if (error && !error.message.includes('already exists')) {
      throw new Error(`Storage bucket: ${error.message}`);
    }
  }
  bucketReady = true;
}

export function proposalStoragePaths(workspaceId: string, proposalId: string) {
  const base = `${workspaceId}/${proposalId}`;
  return {
    docx: `${base}/proposta.docx`,
    pdf: `${base}/proposta.pdf`,
  };
}

export async function uploadProposalFile(
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  await ensureBucket();
  const { error } = await supabase.storage.from(COMMERCIAL_PROPOSALS_BUCKET).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Upload proposta (${path}): ${error.message}`);
}

export async function downloadProposalFile(path: string): Promise<Buffer | null> {
  await ensureBucket();
  const { data, error } = await supabase.storage.from(COMMERCIAL_PROPOSALS_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

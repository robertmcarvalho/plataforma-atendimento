/**
 * Storage privado do PDF do boleto (espelho da URL Cora).
 * Paths canônicos: {workspaceId}/{bankSlipId}/boleto.pdf
 */

export const BILLING_BANK_SLIPS_BUCKET = 'billing-bank-slips';

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
  const exists = buckets?.some((b) => b.name === BILLING_BANK_SLIPS_BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BILLING_BANK_SLIPS_BUCKET, {
      public: false,
      fileSizeLimit: 10 * 1024 * 1024,
    });
    if (error && !error.message.includes('already exists')) {
      throw new Error(`Storage bucket billing-bank-slips: ${error.message}`);
    }
  }
  bucketReady = true;
}

export function bankSlipStoragePaths(workspaceId: string, bankSlipId: string) {
  return {
    boletoPdf: `${workspaceId}/${bankSlipId}/boleto.pdf`,
  };
}

export async function uploadBankSlipPdf(path: string, buffer: Buffer): Promise<void> {
  await ensureBucket();
  const supabase = await getSupabase();
  const { error } = await supabase.storage.from(BILLING_BANK_SLIPS_BUCKET).upload(path, buffer, {
    contentType: 'application/pdf',
    upsert: true,
  });
  if (error) throw new Error(`Upload boleto PDF (${path}): ${error.message}`);
}

export async function downloadBankSlipPdf(path: string): Promise<Buffer | null> {
  await ensureBucket();
  const supabase = await getSupabase();
  const { data, error } = await supabase.storage.from(BILLING_BANK_SLIPS_BUCKET).download(path);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

/** Reset interno de testes unitários. */
export function __resetBillingBankSlipsBucketCacheForTests(): void {
  bucketReady = false;
}

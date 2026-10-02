import { randomUUID } from 'crypto';
import { supabase } from './supabase';

const STORAGE_BUCKET = 'message-media';
const STORAGE_UPLOAD_TIMEOUT_MS = 30_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} excedeu ${Math.round(ms / 1000)}s`)), ms);
    }),
  ]);
}

function safeFileName(fileName: string): string {
  return String(fileName || 'arquivo').replace(/[^\w.\-()+\s]/g, '_');
}

/** Upload direto — bucket message-media já existe em produção (sem listBuckets). */
export async function uploadOutboundMessageMedia(
  buffer: Buffer,
  fileName: string,
  mimeType: string
): Promise<string> {
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}-${safeFileName(fileName)}`;
  return withTimeout(
    (async () => {
      const { error } = await supabase.storage.from(STORAGE_BUCKET).upload(path, buffer, {
        contentType: mimeType,
        upsert: false,
      });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from(STORAGE_BUCKET).getPublicUrl(path);
      return data.publicUrl;
    })(),
    STORAGE_UPLOAD_TIMEOUT_MS,
    'Upload storage'
  );
}

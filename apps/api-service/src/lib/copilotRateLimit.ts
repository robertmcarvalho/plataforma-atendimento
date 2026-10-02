import { supabase } from './supabase';

type Bucket = { count: number; windowStartMs: number };

const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 20;

const memoryBuckets = new Map<string, Bucket>();

function memoryRateLimitHit(userId: string): boolean {
  const now = Date.now();
  const b = memoryBuckets.get(userId);
  if (!b || now - b.windowStartMs >= WINDOW_MS) {
    memoryBuckets.set(userId, { count: 1, windowStartMs: now });
    return false;
  }
  if (b.count >= MAX_PER_WINDOW) return true;
  b.count += 1;
  return false;
}

export async function copilotRateLimitHitAsync(userId: string): Promise<boolean> {
  const bucketKey = `copilot:${userId}`;
  const now = new Date();
  const windowStart = new Date(Math.floor(now.getTime() / WINDOW_MS) * WINDOW_MS);

  try {
    const { data: existing, error: readErr } = await supabase
      .from('rate_limit_buckets')
      .select('window_start, hit_count')
      .eq('bucket_key', bucketKey)
      .maybeSingle();

    if (readErr) {
      if ((readErr.message || '').includes('does not exist')) return memoryRateLimitHit(userId);
      return memoryRateLimitHit(userId);
    }

    const existingStart = existing?.window_start ? new Date(String(existing.window_start)).getTime() : 0;
    const sameWindow = existing && existingStart === windowStart.getTime();

    if (!sameWindow) {
      const { error: upsertErr } = await supabase.from('rate_limit_buckets').upsert(
        {
          bucket_key: bucketKey,
          window_start: windowStart.toISOString(),
          hit_count: 1,
          updated_at: now.toISOString(),
        },
        { onConflict: 'bucket_key' }
      );
      if (upsertErr) return memoryRateLimitHit(userId);
      return false;
    }

    const count = Number(existing?.hit_count || 0);
    if (count >= MAX_PER_WINDOW) return true;

    const { error: updateErr } = await supabase
      .from('rate_limit_buckets')
      .update({ hit_count: count + 1, updated_at: now.toISOString() })
      .eq('bucket_key', bucketKey)
      .eq('window_start', existing.window_start);

    if (updateErr) return memoryRateLimitHit(userId);
    return false;
  } catch {
    return memoryRateLimitHit(userId);
  }
}

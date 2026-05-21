-- Shared rate-limit buckets (multi-replica safe via row-level upsert).
CREATE TABLE IF NOT EXISTS public.rate_limit_buckets (
  bucket_key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  hit_count int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_buckets_updated
  ON public.rate_limit_buckets(updated_at DESC);

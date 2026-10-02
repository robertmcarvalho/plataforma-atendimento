-- Idempotência do disparo de CSAT ao encerrar atendimento.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS csat_sent_at timestamptz;

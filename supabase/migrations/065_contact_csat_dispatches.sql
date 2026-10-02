-- CSAT por contato/setor/mês + resposta na conversa resolvida.

CREATE TABLE IF NOT EXISTS public.contact_csat_dispatches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES public.contacts(id) ON DELETE CASCADE,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL,
  conversation_id uuid NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz,
  score smallint CHECK (score IS NULL OR (score >= 1 AND score <= 5)),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_csat_dispatches_monthly
  ON public.contact_csat_dispatches (workspace_id, contact_id, sector_id, sent_at DESC);

CREATE INDEX IF NOT EXISTS idx_contact_csat_dispatches_pending
  ON public.contact_csat_dispatches (workspace_id, contact_id, sent_at DESC)
  WHERE responded_at IS NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS csat_score smallint CHECK (csat_score IS NULL OR (csat_score >= 1 AND csat_score <= 5)),
  ADD COLUMN IF NOT EXISTS csat_responded_at timestamptz;

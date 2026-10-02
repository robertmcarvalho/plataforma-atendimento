-- Proposta comercial: documento HTML editável + status pdf_ready

ALTER TABLE public.commercial_proposals
  ADD COLUMN IF NOT EXISTS document_html text,
  ADD COLUMN IF NOT EXISTS document_source jsonb,
  ADD COLUMN IF NOT EXISTS document_saved_at timestamptz,
  ADD COLUMN IF NOT EXISTS document_saved_by uuid REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.commercial_proposals DROP CONSTRAINT IF EXISTS commercial_proposals_status_check;

ALTER TABLE public.commercial_proposals
  ADD CONSTRAINT commercial_proposals_status_check
  CHECK (status IN ('draft', 'pdf_ready', 'sent', 'accepted'));

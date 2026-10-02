-- Proposta comercial: template versionado + artefatos DOCX/PDF em storage

ALTER TABLE public.commercial_proposals
  ADD COLUMN IF NOT EXISTS template_version integer,
  ADD COLUMN IF NOT EXISTS docx_storage_path text,
  ADD COLUMN IF NOT EXISTS pdf_storage_path text;

COMMENT ON COLUMN public.commercial_proposals.template_version IS 'Versão do template Word (ex.: Royal Farma v1)';
COMMENT ON COLUMN public.commercial_proposals.docx_storage_path IS 'Caminho no bucket commercial-proposals';
COMMENT ON COLUMN public.commercial_proposals.pdf_storage_path IS 'Caminho do PDF oficial no bucket commercial-proposals';

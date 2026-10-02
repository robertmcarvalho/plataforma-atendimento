-- Cadastro inicial de lead: CNPJ e nome do contato passam a ser opcionais.

ALTER TABLE public.commercial_leads
  DROP CONSTRAINT IF EXISTS commercial_leads_workspace_id_cnpj_key;

ALTER TABLE public.commercial_leads
  ALTER COLUMN cnpj DROP NOT NULL,
  ALTER COLUMN contact_name DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_leads_workspace_cnpj_unique
  ON public.commercial_leads (workspace_id, cnpj)
  WHERE cnpj IS NOT NULL AND cnpj <> '';

-- Cadastro inicial de lead: nome fantasia, cidade e UF passam a ser opcionais.

ALTER TABLE public.commercial_leads
  ALTER COLUMN trade_name DROP NOT NULL,
  ALTER COLUMN city DROP NOT NULL,
  ALTER COLUMN state DROP NOT NULL;

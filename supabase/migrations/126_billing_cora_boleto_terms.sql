-- Condições comerciais do boleto Cora (multa / juros / PIX / templates).
-- Defaults: multa 2% (rate), juros 1% a.m., PIX ligado, templates Flux.
-- interest.rate na API Cora: 0–100 com 2 casas; docs Cora não explicitam período —
-- operação trata como % a.m. (prática comercial de boleto BR).

DO $$ BEGIN
  CREATE TYPE public.billing_cora_fine_mode AS ENUM ('none', 'rate', 'amount');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.billing_cora_configs
  ADD COLUMN IF NOT EXISTS fine_mode public.billing_cora_fine_mode NOT NULL DEFAULT 'rate',
  ADD COLUMN IF NOT EXISTS fine_rate numeric(5, 2) DEFAULT 2.00,
  ADD COLUMN IF NOT EXISTS fine_amount_cents integer,
  ADD COLUMN IF NOT EXISTS interest_rate numeric(5, 2) DEFAULT 1.00,
  ADD COLUMN IF NOT EXISTS pix_qr_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS service_name_template text NOT NULL
    DEFAULT 'Faturamento Flux Farma — {{cycle}}',
  ADD COLUMN IF NOT EXISTS service_description_template text NOT NULL
    DEFAULT 'Fatura {{invoice_id}} — ciclo {{cycle}}';

ALTER TABLE public.billing_cora_configs
  DROP CONSTRAINT IF EXISTS billing_cora_configs_fine_rate_check;
ALTER TABLE public.billing_cora_configs
  ADD CONSTRAINT billing_cora_configs_fine_rate_check
  CHECK (fine_rate IS NULL OR (fine_rate >= 0 AND fine_rate <= 100));

ALTER TABLE public.billing_cora_configs
  DROP CONSTRAINT IF EXISTS billing_cora_configs_fine_amount_check;
ALTER TABLE public.billing_cora_configs
  ADD CONSTRAINT billing_cora_configs_fine_amount_check
  CHECK (fine_amount_cents IS NULL OR fine_amount_cents >= 0);

ALTER TABLE public.billing_cora_configs
  DROP CONSTRAINT IF EXISTS billing_cora_configs_interest_rate_check;
ALTER TABLE public.billing_cora_configs
  ADD CONSTRAINT billing_cora_configs_interest_rate_check
  CHECK (interest_rate IS NULL OR (interest_rate >= 0 AND interest_rate <= 100));

COMMENT ON COLUMN public.billing_cora_configs.fine_mode IS
  'none = omite fine; rate → payment_terms.fine.rate (%); amount → payment_terms.fine.amount (centavos; precedência na Cora).';
COMMENT ON COLUMN public.billing_cora_configs.fine_rate IS
  'Multa percentual (0–100). Default 2. Mapeia para payment_terms.fine.rate.';
COMMENT ON COLUMN public.billing_cora_configs.fine_amount_cents IS
  'Multa fixa em centavos. Só usado com fine_mode=amount → payment_terms.fine.amount.';
COMMENT ON COLUMN public.billing_cora_configs.interest_rate IS
  'Juros: payment_terms.interest.rate (0–100, 2 casas). Docs Cora não dizem se é a.m.; UI/produto tratam como % a.m. NULL = omite interest.';
COMMENT ON COLUMN public.billing_cora_configs.pix_qr_enabled IS
  'true → payment_forms: [BANK_SLIP, PIX]; false → omite payment_forms (só boleto). Requer chave Pix na conta Cora.';
COMMENT ON COLUMN public.billing_cora_configs.service_name_template IS
  'Template services[].name (máx 60 na Cora). Placeholders: {{cycle}}, {{invoice_id}}, {{pharmacy}}, {{cnpj}}.';
COMMENT ON COLUMN public.billing_cora_configs.service_description_template IS
  'Template services[].description (máx 100 na Cora). Mesmos placeholders.';

-- Atualiza linhas Flux existentes com defaults comerciais (não sobrescreve se já customizado via coluna nova com DEFAULT).
UPDATE public.billing_cora_configs
SET
  fine_mode = COALESCE(fine_mode, 'rate'),
  fine_rate = COALESCE(fine_rate, 2.00),
  interest_rate = COALESCE(interest_rate, 1.00),
  pix_qr_enabled = COALESCE(pix_qr_enabled, true),
  service_name_template = COALESCE(
    NULLIF(trim(service_name_template), ''),
    'Faturamento Flux Farma — {{cycle}}'
  ),
  service_description_template = COALESCE(
    NULLIF(trim(service_description_template), ''),
    'Fatura {{invoice_id}} — ciclo {{cycle}}'
  ),
  updated_at = now()
WHERE entity_type = 'flux';

-- CREATE OR REPLACE não pode reordenar/renomear colunas de view existente.
DROP VIEW IF EXISTS public.billing_cora_configs_public;

CREATE VIEW public.billing_cora_configs_public AS
SELECT
  id,
  workspace_id,
  entity_type,
  environment,
  enabled,
  mtls_secret_ref,
  (client_id IS NOT NULL AND length(trim(client_id)) > 0) AS has_client_id,
  CASE
    WHEN client_id IS NULL OR length(trim(client_id)) = 0 THEN NULL
    WHEN length(trim(client_id)) <= 8 THEN repeat('*', length(trim(client_id)))
    ELSE left(trim(client_id), 4) || repeat('*', greatest(length(trim(client_id)) - 8, 0)) || right(trim(client_id), 4)
  END AS client_id_masked,
  fine_mode,
  fine_rate,
  fine_amount_cents,
  interest_rate,
  pix_qr_enabled,
  service_name_template,
  service_description_template,
  created_at,
  updated_at
FROM public.billing_cora_configs;

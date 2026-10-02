-- Cora boletos (Integração Direta / mTLS) — MVP Flux + Stage + emissão manual.
-- Aplicar preferencialmente em billing-dev até validação Stage.
-- Feature flag runtime: BILLING_CORA_ENABLED (default false).
-- Nunca persistir PEM / private key / senha em colunas públicas — só secret_ref + client_id via UI.

DO $$ BEGIN
  CREATE TYPE public.billing_cora_environment AS ENUM ('stage', 'production');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_bank_slip_status AS ENUM (
    'pending',
    'open',
    'paid',
    'canceled',
    'error'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Config por entidade (Flux no MVP; Coop depois).
-- client_id: configurável na UI (não hardcodar no source).
-- mtls_secret_ref: pasta/nome sob .secrets ou Secret Manager (ex.: cora-flux-mtls).
CREATE TABLE IF NOT EXISTS public.billing_cora_configs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type             public.billing_legal_entity_type NOT NULL,
  environment             public.billing_cora_environment NOT NULL DEFAULT 'stage',
  client_id               text,
  mtls_secret_ref         text,
  enabled                 boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_cora_configs_workspace_entity_unique
    UNIQUE (workspace_id, entity_type)
);

CREATE INDEX IF NOT EXISTS idx_billing_cora_configs_workspace
  ON public.billing_cora_configs (workspace_id, enabled);

COMMENT ON TABLE public.billing_cora_configs IS
  'Config Cora Integração Direta por entidade (coop|flux). Material mTLS em secret_ref, nunca PEM em claro.';
COMMENT ON COLUMN public.billing_cora_configs.client_id IS
  'Client ID da Integração Direta (menu Conta → Integrações). Configurável via UI; não versionar no git.';
COMMENT ON COLUMN public.billing_cora_configs.mtls_secret_ref IS
  'Nome da pasta/secret com certificate.pem + private-key.key (ex.: cora-flux-mtls).';
COMMENT ON COLUMN public.billing_cora_configs.environment IS
  'stage → matls-clients.api.stage.cora.com.br; production → matls-clients.api.cora.com.br.';

CREATE TABLE IF NOT EXISTS public.billing_bank_slips (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id              uuid NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  entity_type             public.billing_legal_entity_type NOT NULL,
  provider                text NOT NULL DEFAULT 'cora',
  config_id               uuid REFERENCES public.billing_cora_configs(id) ON DELETE SET NULL,
  external_id             text,
  status                  public.billing_bank_slip_status NOT NULL DEFAULT 'pending',
  digitable_line          text,
  barcode                 text,
  our_number              text,
  pdf_url                 text,
  amount_cents            integer NOT NULL CHECK (amount_cents >= 0),
  due_date                date,
  idempotency_key         uuid NOT NULL,
  last_error              text,
  paid_at                 timestamptz,
  webhook_event_id        text,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_bank_slips_provider_check CHECK (provider = 'cora'),
  CONSTRAINT billing_bank_slips_idempotency_unique UNIQUE (workspace_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_billing_bank_slips_workspace_invoice
  ON public.billing_bank_slips (workspace_id, invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_bank_slips_external
  ON public.billing_bank_slips (workspace_id, provider, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_bank_slips_status
  ON public.billing_bank_slips (workspace_id, status);

COMMENT ON TABLE public.billing_bank_slips IS
  'Boletos emitidos (Cora v2). Webhook de liquidação: TODO fase posterior.';
COMMENT ON COLUMN public.billing_bank_slips.webhook_event_id IS
  'Reservado para idempotência de webhook invoice.paid (ainda não implementado).';

-- View pública: nunca expõe client_id completo em listagens genéricas (API usa tabela + mask).
CREATE OR REPLACE VIEW public.billing_cora_configs_public AS
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
  created_at,
  updated_at
FROM public.billing_cora_configs;

COMMENT ON VIEW public.billing_cora_configs_public IS
  'Metadados Cora sem client_id em claro — preferir em listagens; UI de edição usa endpoint manage.';

-- Seed: uma linha Flux por workspace existente (disabled, stage). Coop fora do MVP.
INSERT INTO public.billing_cora_configs (
  workspace_id,
  entity_type,
  environment,
  mtls_secret_ref,
  enabled
)
SELECT
  w.id,
  'flux'::public.billing_legal_entity_type,
  'stage'::public.billing_cora_environment,
  'cora-flux-mtls',
  false
FROM public.workspaces w
ON CONFLICT (workspace_id, entity_type) DO NOTHING;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_cora_configs',
    'billing_bank_slips'
  ]
  LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.routines
      WHERE routine_schema = 'public' AND routine_name = 'ensure_tenant_rls_policies'
    ) THEN
      PERFORM public.ensure_tenant_rls_policies(t);
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

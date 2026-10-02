-- NFS-e Sprint 0 — fundação (aplicar SOMENTE em billing-dev / staging até gate homologação).
-- NÃO aplicar em produção (omhlb) sem aprovação explícita.
-- Feature flag runtime: BILLING_NFSE_ENABLED (default false) — ver docs/BILLING_NFSE_STAGING.md.

DO $$ BEGIN
  CREATE TYPE public.billing_nfse_environment AS ENUM ('producao_restrita', 'producao');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_nfse_revenue_line AS ENUM (
    'delivery',
    'saas_monthly',
    'saas_per_delivery'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_nfse_document_status AS ENUM (
    'pending',
    'authorized',
    'rejected',
    'canceled'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Tomador (farmácia): campos fiscais ausentes no cadastro atual.
ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS municipal_registration text;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS ibge_city_code text;

COMMENT ON COLUMN public.pharmacies.municipal_registration IS
  'Inscrição municipal do tomador (NFS-e). Obrigatória no gate se regra local exigir.';
COMMENT ON COLUMN public.pharmacies.ibge_city_code IS
  'Código IBGE do município do tomador (7 dígitos). Obrigatório para emissão NFS-e.';

CREATE TABLE IF NOT EXISTS public.billing_nfse_issuer_configs (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  entity_type             public.billing_legal_entity_type NOT NULL,
  environment             public.billing_nfse_environment NOT NULL DEFAULT 'producao_restrita',
  auto_emit_on_approve    boolean NOT NULL DEFAULT true,
  municipal_registration  text,
  ibge_city_code          text NOT NULL DEFAULT '3170206',
  tax_regime              text,
  simples_nacional        boolean NOT NULL DEFAULT false,
  dps_series              text,
  dps_next_number         integer CHECK (dps_next_number IS NULL OR dps_next_number >= 1),
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_nfse_issuer_configs_workspace_entity_unique
    UNIQUE (workspace_id, entity_type),
  CONSTRAINT billing_nfse_issuer_configs_ibge_digits
    CHECK (ibge_city_code ~ '^[0-9]{7}$')
);

CREATE INDEX IF NOT EXISTS idx_billing_nfse_issuer_configs_workspace
  ON public.billing_nfse_issuer_configs (workspace_id, active);

COMMENT ON TABLE public.billing_nfse_issuer_configs IS
  'Config NFS-e por emitente (coop|flux). Ambiente default produção restrita.';
COMMENT ON COLUMN public.billing_nfse_issuer_configs.ibge_city_code IS
  'Município de incidência do ISS do prestador (default Uberlândia 3170206).';

CREATE TABLE IF NOT EXISTS public.billing_nfse_service_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  issuer_config_id        uuid NOT NULL REFERENCES public.billing_nfse_issuer_configs(id) ON DELETE CASCADE,
  revenue_line            public.billing_nfse_revenue_line NOT NULL,
  ctn                     text NOT NULL,
  nbs                     text NOT NULL,
  iss_rate_pct            numeric(5, 2)
    CHECK (iss_rate_pct IS NULL OR (iss_rate_pct >= 0 AND iss_rate_pct <= 100)),
  description_template    text NOT NULL,
  active                  boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_nfse_service_profiles_issuer_line_unique
    UNIQUE (issuer_config_id, revenue_line)
);

CREATE INDEX IF NOT EXISTS idx_billing_nfse_service_profiles_workspace
  ON public.billing_nfse_service_profiles (workspace_id, active);

COMMENT ON TABLE public.billing_nfse_service_profiles IS
  'Perfil fiscal por linha de receita (delivery / saas_*). SaaS pode ficar inactive.';
COMMENT ON COLUMN public.billing_nfse_service_profiles.description_template IS
  'Placeholders: {{cycle_start}} {{cycle_end}} {{pharmacy}}';
COMMENT ON COLUMN public.billing_nfse_service_profiles.iss_rate_pct IS
  'Alíquota ISS; NULL quando optante do Simples Nacional.';

-- Metadados do certificado A1 apenas — sem PEM/PFX em claro.
-- Material fica em Secret Manager / .secrets (secret_ref).
CREATE TABLE IF NOT EXISTS public.billing_nfse_certificates (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  issuer_config_id        uuid NOT NULL REFERENCES public.billing_nfse_issuer_configs(id) ON DELETE CASCADE,
  thumbprint              text,
  subject_cn              text,
  valid_from              timestamptz,
  valid_until             timestamptz,
  secret_ref              text,
  pfx_storage_path        text,
  active                  boolean NOT NULL DEFAULT true,
  uploaded_at             timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_nfse_certificates_issuer_unique UNIQUE (issuer_config_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_nfse_certificates_workspace
  ON public.billing_nfse_certificates (workspace_id, active);

COMMENT ON TABLE public.billing_nfse_certificates IS
  'Metadados A1 por emitente. Nunca persistir PEM/PFX em texto claro nesta tabela.';
COMMENT ON COLUMN public.billing_nfse_certificates.secret_ref IS
  'Nome do secret (GCP SM ou chave .secrets), ex.: billing-nfse-coop-pfx.';
COMMENT ON COLUMN public.billing_nfse_certificates.pfx_storage_path IS
  'Path opcional cifrado no Storage; listagens de API não devem devolver conteúdo.';

-- View segura para SELECT público de metadados (sem path sensível se desejado).
CREATE OR REPLACE VIEW public.billing_nfse_certificates_public AS
SELECT
  id,
  workspace_id,
  issuer_config_id,
  thumbprint,
  subject_cn,
  valid_from,
  valid_until,
  active,
  uploaded_at,
  created_at,
  updated_at,
  (secret_ref IS NOT NULL AND length(trim(secret_ref)) > 0) AS has_secret_ref,
  (pfx_storage_path IS NOT NULL AND length(trim(pfx_storage_path)) > 0) AS has_storage_path
FROM public.billing_nfse_certificates;

COMMENT ON VIEW public.billing_nfse_certificates_public IS
  'Metadados de certificado sem secret_ref/path em claro — preferir em listagens API.';

CREATE TABLE IF NOT EXISTS public.billing_nfse_documents (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id              uuid NOT NULL REFERENCES public.billing_invoices(id) ON DELETE CASCADE,
  issuer_config_id        uuid REFERENCES public.billing_nfse_issuer_configs(id) ON DELETE SET NULL,
  entity_type             public.billing_legal_entity_type NOT NULL,
  revenue_line            public.billing_nfse_revenue_line NOT NULL DEFAULT 'delivery',
  status                  public.billing_nfse_document_status NOT NULL DEFAULT 'pending',
  attempt_number          integer NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  dps_number              text,
  nfse_number             text,
  access_key              text,
  protocol                text,
  last_error              text,
  xml_storage_path        text,
  pdf_storage_path        text,
  issued_at               timestamptz,
  authorized_at           timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_nfse_documents_workspace_invoice
  ON public.billing_nfse_documents (workspace_id, invoice_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_nfse_documents_status
  ON public.billing_nfse_documents (workspace_id, status);

COMMENT ON TABLE public.billing_nfse_documents IS
  'Documentos NFS-e por fatura (histórico de tentativas). Emit on approve → status pending.';

-- Seed defaults: Coop + Flux delivery ativos; SaaS profiles inativos.
-- CTN 26.01.01 / NBS 1.0702.00.00; Coop ISS 3%; Flux SN; Uberlândia; producao_restrita.
INSERT INTO public.billing_nfse_issuer_configs (
  workspace_id,
  entity_type,
  environment,
  auto_emit_on_approve,
  municipal_registration,
  ibge_city_code,
  tax_regime,
  simples_nacional,
  dps_series,
  dps_next_number,
  active
)
SELECT
  le.workspace_id,
  le.entity_type,
  'producao_restrita'::public.billing_nfse_environment,
  true,
  le.municipal_registration,
  '3170206',
  le.tax_regime,
  (le.entity_type = 'flux'),
  NULL, -- série DPS: configurar na UI (Sprint 1) a partir da série SD-Control
  NULL,
  true
FROM public.billing_legal_entities le
ON CONFLICT (workspace_id, entity_type) DO NOTHING;

INSERT INTO public.billing_nfse_service_profiles (
  workspace_id,
  issuer_config_id,
  revenue_line,
  ctn,
  nbs,
  iss_rate_pct,
  description_template,
  active
)
SELECT
  ic.workspace_id,
  ic.id,
  'delivery'::public.billing_nfse_revenue_line,
  '26.01.01',
  '1.0702.00.00',
  CASE WHEN ic.entity_type = 'coop' THEN 3.00 ELSE NULL END,
  'Prestação de serviços de entrega no período de {{cycle_start}} a {{cycle_end}} — {{pharmacy}}',
  true
FROM public.billing_nfse_issuer_configs ic
ON CONFLICT (issuer_config_id, revenue_line) DO NOTHING;

INSERT INTO public.billing_nfse_service_profiles (
  workspace_id,
  issuer_config_id,
  revenue_line,
  ctn,
  nbs,
  iss_rate_pct,
  description_template,
  active
)
SELECT
  ic.workspace_id,
  ic.id,
  line.revenue_line,
  '010501',
  '1.1103.22.00',
  CASE WHEN ic.entity_type = 'coop' THEN 3.00 ELSE NULL END,
  line.description_template,
  false
FROM public.billing_nfse_issuer_configs ic
CROSS JOIN (
  VALUES
    (
      'saas_monthly'::public.billing_nfse_revenue_line,
      'Disponibilização de tecnologia (SaaS mensal) — {{pharmacy}} — competência {{cycle_start}} a {{cycle_end}}'
    ),
    (
      'saas_per_delivery'::public.billing_nfse_revenue_line,
      'Disponibilização de tecnologia (SaaS por entrega) — {{pharmacy}} — período {{cycle_start}} a {{cycle_end}}'
    )
) AS line(revenue_line, description_template)
ON CONFLICT (issuer_config_id, revenue_line) DO NOTHING;

-- RLS tenant (mesmo padrão wave billing).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'billing_nfse_issuer_configs',
    'billing_nfse_service_profiles',
    'billing_nfse_certificates',
    'billing_nfse_documents'
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

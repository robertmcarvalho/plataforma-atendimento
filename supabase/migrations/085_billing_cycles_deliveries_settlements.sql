-- Fase 1 — ciclos, entregas e acertos (aplicar SOMENTE em banco dev/staging até gate QA)

DO $$ BEGIN
  CREATE TYPE public.billing_cycle_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_settlement_status AS ENUM ('open', 'in_review', 'approved', 'paid');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_delivery_source AS ENUM ('flux_api', 'flux_db', 'manual', 'csv', 'external_app');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.billing_settlement_line_kind AS ENUM (
    'deliveries',
    'minimum_guarantee',
    'daily',
    'absence',
    'quota',
    'advance',
    'uniform',
    'bag',
    'other_discount',
    'adjustment'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_cycles (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  label             text,
  apuracao_start    date NOT NULL,
  apuracao_end      date NOT NULL,
  payment_date      date,
  status            public.billing_cycle_status NOT NULL DEFAULT 'open',
  closed_at         timestamptz,
  closed_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_cycles_apuracao_range CHECK (apuracao_end >= apuracao_start),
  CONSTRAINT billing_cycles_workspace_range_unique UNIQUE (workspace_id, apuracao_start, apuracao_end)
);

CREATE INDEX IF NOT EXISTS idx_billing_cycles_workspace_status
  ON public.billing_cycles (workspace_id, status, apuracao_start DESC);

COMMENT ON TABLE public.billing_cycles IS 'Ciclos de apuração seg–dom para faturamento e acertos';

CREATE TABLE IF NOT EXISTS public.billing_delivery_records (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id      uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_cycle_id  uuid REFERENCES public.billing_cycles(id) ON DELETE SET NULL,
  source            public.billing_delivery_source NOT NULL DEFAULT 'manual',
  external_id       text NOT NULL,
  flux_codpes       integer,
  flux_codloc       integer,
  pharmacy_id       uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  driver_id         uuid NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  delivered_at      timestamptz NOT NULL,
  document_number   text,
  route_id          text,
  cancelled         boolean NOT NULL DEFAULT false,
  verified          boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_delivery_records_workspace_source_external UNIQUE (workspace_id, source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_delivery_records_cycle
  ON public.billing_delivery_records (billing_cycle_id, pharmacy_id, driver_id)
  WHERE cancelled = false;

CREATE INDEX IF NOT EXISTS idx_billing_delivery_records_delivered_at
  ON public.billing_delivery_records (workspace_id, delivered_at DESC);

COMMENT ON TABLE public.billing_delivery_records IS 'Entregas apuradas (manual, CSV, Flux) por ciclo';

CREATE TABLE IF NOT EXISTS public.billing_settlements (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id            uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_cycle_id        uuid NOT NULL REFERENCES public.billing_cycles(id) ON DELETE CASCADE,
  driver_id               uuid NOT NULL REFERENCES public.drivers(id) ON DELETE RESTRICT,
  pharmacy_id             uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE RESTRICT,
  delivery_count          integer NOT NULL DEFAULT 0,
  pharmacy_charge_cents   integer NOT NULL DEFAULT 0,
  driver_payout_cents     integer NOT NULL DEFAULT 0,
  coop_cents              integer NOT NULL DEFAULT 0,
  flux_cents              integer NOT NULL DEFAULT 0,
  discounts_cents         integer NOT NULL DEFAULT 0,
  net_driver_payout_cents integer NOT NULL DEFAULT 0,
  applied_mg              boolean NOT NULL DEFAULT false,
  status                  public.billing_settlement_status NOT NULL DEFAULT 'open',
  submitted_at            timestamptz,
  submitted_by            uuid REFERENCES public.users(id) ON DELETE SET NULL,
  approved_at             timestamptz,
  approved_by             uuid REFERENCES public.users(id) ON DELETE SET NULL,
  paid_at                 timestamptz,
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_settlements_cycle_driver_pharmacy_unique
    UNIQUE (billing_cycle_id, driver_id, pharmacy_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_settlements_cycle_status
  ON public.billing_settlements (billing_cycle_id, status);

COMMENT ON TABLE public.billing_settlements IS 'Acerto driver × farmácia × ciclo';

CREATE TABLE IF NOT EXISTS public.billing_settlement_lines (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id         uuid NOT NULL REFERENCES public.billing_settlements(id) ON DELETE CASCADE,
  kind                  public.billing_settlement_line_kind NOT NULL,
  description           text,
  pharmacy_amount_cents integer NOT NULL DEFAULT 0,
  driver_amount_cents   integer NOT NULL DEFAULT 0,
  metadata              jsonb NOT NULL DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_settlement_lines_settlement
  ON public.billing_settlement_lines (settlement_id);

-- C1 diária-base (farmácia) + overlays de acerto (dias confirmados e multiplicador MG)

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS driver_day_base_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS driver_day_base_cents integer NOT NULL DEFAULT 7000
  CHECK (driver_day_base_cents >= 0);

COMMENT ON COLUMN public.pharmacies.driver_day_base_enabled IS
  'Quando true, o acerto pode gerar diária-base (repasse + cobrança) nos dias confirmados no ciclo.';
COMMENT ON COLUMN public.pharmacies.driver_day_base_cents IS
  'Valor default da diária-base por dia de escala (ex.: 7000 = R$70). Não substitui daily_billing_*.';

-- Dias confirmados no acerto (sobrevive a recalculate)
CREATE TABLE IF NOT EXISTS public.billing_settlement_day_base_days (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_cycle_id     uuid NOT NULL REFERENCES public.billing_cycles(id) ON DELETE CASCADE,
  pharmacy_id          uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  driver_id            uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  event_date           date NOT NULL,
  amount_cents         integer NOT NULL CHECK (amount_cents >= 0),
  created_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  active               boolean NOT NULL DEFAULT true,
  CONSTRAINT billing_settlement_day_base_days_uniq
    UNIQUE (workspace_id, billing_cycle_id, pharmacy_id, driver_id, event_date)
);

CREATE INDEX IF NOT EXISTS idx_billing_settlement_day_base_days_cycle
  ON public.billing_settlement_day_base_days (workspace_id, billing_cycle_id, pharmacy_id)
  WHERE active = true;

COMMENT ON TABLE public.billing_settlement_day_base_days IS
  'Overlay C1: dias de diária-base confirmados no acerto. Pagamento só na quinta; cobrança na fatura.';

-- Multiplicador MG assimétrico (só repasse) por par no ciclo
CREATE TABLE IF NOT EXISTS public.billing_settlement_mg_overlays (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_cycle_id     uuid NOT NULL REFERENCES public.billing_cycles(id) ON DELETE CASCADE,
  pharmacy_id          uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  driver_id            uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  multiplier           numeric(3,1) NOT NULL CHECK (multiplier IN (0.5, 1.0, 2.0)),
  justification        text NOT NULL,
  created_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  active               boolean NOT NULL DEFAULT true,
  CONSTRAINT billing_settlement_mg_overlays_justification_len CHECK (char_length(btrim(justification)) >= 3),
  CONSTRAINT billing_settlement_mg_overlays_uniq
    UNIQUE (workspace_id, billing_cycle_id, pharmacy_id, driver_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_settlement_mg_overlays_cycle
  ON public.billing_settlement_mg_overlays (workspace_id, billing_cycle_id, pharmacy_id)
  WHERE active = true;

COMMENT ON TABLE public.billing_settlement_mg_overlays IS
  'Overlay C2: multiplicador de período no MG do acerto. Fator aplica-se só ao repasse (driver_amount).';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_tenant_rls_policies'
  ) THEN
    PERFORM public.ensure_tenant_rls_policies('billing_settlement_day_base_days');
    EXECUTE 'ALTER TABLE public.billing_settlement_day_base_days ENABLE ROW LEVEL SECURITY';
    PERFORM public.ensure_tenant_rls_policies('billing_settlement_mg_overlays');
    EXECUTE 'ALTER TABLE public.billing_settlement_mg_overlays ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

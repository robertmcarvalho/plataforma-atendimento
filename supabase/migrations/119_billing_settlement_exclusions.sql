-- Overlay de exclusão persistente no acerto (linha ou entregador × farmácia × ciclo).
-- Recálculo relê esta tabela; não apaga lançamento do Financeiro.

CREATE TABLE IF NOT EXISTS public.billing_settlement_exclusions (
  id                              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  billing_cycle_id                uuid NOT NULL REFERENCES public.billing_cycles(id) ON DELETE CASCADE,
  pharmacy_id                     uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  driver_id                       uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  settlement_id                   uuid REFERENCES public.billing_settlements(id) ON DELETE SET NULL,
  line_id                         uuid REFERENCES public.billing_settlement_lines(id) ON DELETE SET NULL,
  scope                           text NOT NULL CHECK (scope IN ('driver', 'line')),
  line_kind                       text,
  line_fingerprint                text,
  justification                   text NOT NULL,
  pharmacy_amount_cents_before    integer NOT NULL DEFAULT 0,
  driver_amount_cents_before      integer NOT NULL DEFAULT 0,
  created_by                      uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at                      timestamptz NOT NULL DEFAULT now(),
  active                          boolean NOT NULL DEFAULT true,
  CONSTRAINT billing_settlement_exclusions_justification_len CHECK (char_length(btrim(justification)) >= 3),
  CONSTRAINT billing_settlement_exclusions_line_kind_check CHECK (
    line_kind IS NULL OR line_kind IN ('deliveries', 'minimum_guarantee', 'daily')
  )
);

CREATE INDEX IF NOT EXISTS idx_billing_settlement_exclusions_cycle_pharmacy
  ON public.billing_settlement_exclusions (workspace_id, billing_cycle_id, pharmacy_id)
  WHERE active = true;

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_settlement_exclusions_active_uniq
  ON public.billing_settlement_exclusions (
    workspace_id,
    billing_cycle_id,
    pharmacy_id,
    driver_id,
    scope,
    COALESCE(line_kind, ''),
    COALESCE(line_fingerprint, '')
  )
  WHERE active = true;

COMMENT ON TABLE public.billing_settlement_exclusions IS
  'Overlay de faturamento: exclui linha ou entregador do acerto da farmácia no ciclo, com justificativa. Preservado no recálculo.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_tenant_rls_policies'
  ) THEN
    PERFORM public.ensure_tenant_rls_policies('billing_settlement_exclusions');
    EXECUTE 'ALTER TABLE public.billing_settlement_exclusions ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

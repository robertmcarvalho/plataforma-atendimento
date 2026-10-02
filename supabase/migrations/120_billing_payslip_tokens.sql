-- Magic links do holerite do entregador (TTL 7 dias). Token em hash; PDF na página pública.

CREATE TABLE IF NOT EXISTS public.billing_payslip_tokens (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id         uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  payable_id           uuid NOT NULL REFERENCES public.billing_payables(id) ON DELETE CASCADE,
  driver_id            uuid NOT NULL REFERENCES public.drivers(id) ON DELETE CASCADE,
  billing_cycle_id     uuid REFERENCES public.billing_cycles(id) ON DELETE SET NULL,
  track                text NOT NULL CHECK (track IN ('weekly', 'daily')),
  token_hash           text NOT NULL,
  expires_at           timestamptz NOT NULL,
  revoked_at           timestamptz,
  created_by           uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now(),
  last_sent_at         timestamptz,
  last_viewed_at       timestamptz,
  last_send_error      text,
  CONSTRAINT billing_payslip_tokens_hash_len CHECK (char_length(token_hash) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_payslip_tokens_hash
  ON public.billing_payslip_tokens (token_hash);

CREATE INDEX IF NOT EXISTS idx_billing_payslip_tokens_payable
  ON public.billing_payslip_tokens (workspace_id, payable_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_payslip_tokens_driver_cycle
  ON public.billing_payslip_tokens (workspace_id, driver_id, billing_cycle_id, track, created_at DESC);

COMMENT ON TABLE public.billing_payslip_tokens IS
  'Links mágicos do demonstrativo (holerite) do entregador. Envio WhatsApp UTILITY; PDF só na página pública.';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'ensure_tenant_rls_policies'
  ) THEN
    PERFORM public.ensure_tenant_rls_policies('billing_payslip_tokens');
    EXECUTE 'ALTER TABLE public.billing_payslip_tokens ENABLE ROW LEVEL SECURITY';
  END IF;
END $$;

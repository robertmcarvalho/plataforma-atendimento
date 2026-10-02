-- Cancelamento auditável de lançamentos financeiros (adiantamentos).

ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_reason text;

COMMENT ON COLUMN public.financial_entries.cancelled_by IS 'Usuário que cancelou parcelas pendentes do lançamento.';
COMMENT ON COLUMN public.financial_entries.cancelled_at IS 'Data/hora do cancelamento parcial ou total.';
COMMENT ON COLUMN public.financial_entries.cancel_reason IS 'Motivo informado no cancelamento.';

CREATE INDEX IF NOT EXISTS idx_financial_entries_cancelled_by
  ON public.financial_entries(workspace_id, cancelled_by)
  WHERE cancelled_by IS NOT NULL;

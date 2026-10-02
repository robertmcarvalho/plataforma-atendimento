-- Decisão financeira sobre falta (descontar vs abonar)

ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS absence_disposition text,
  ADD COLUMN IF NOT EXISTS proposed_discount_amount numeric,
  ADD COLUMN IF NOT EXISTS disposition_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS disposition_at timestamptz,
  ADD COLUMN IF NOT EXISTS disposition_notes text;

COMMENT ON COLUMN public.financial_entries.absence_disposition IS 'pending | discounted | excused — só para falta (unexcused)';
COMMENT ON COLUMN public.financial_entries.proposed_discount_amount IS 'Valor espelhado da diária do cobridor ao registrar falta com cobertura';

CREATE INDEX IF NOT EXISTS idx_financial_entries_absence_disposition
  ON public.financial_entries(workspace_id, absence_disposition)
  WHERE absence_disposition IS NOT NULL;

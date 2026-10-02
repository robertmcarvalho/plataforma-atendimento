-- Ciclo de apuração e data de evento em lançamentos financeiros
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS event_date date,
  ADD COLUMN IF NOT EXISTS apuracao_start date,
  ADD COLUMN IF NOT EXISTS apuracao_end date;

CREATE INDEX IF NOT EXISTS idx_financial_entries_workspace_type_event
  ON public.financial_entries(workspace_id, type, event_date)
  WHERE event_date IS NOT NULL;

COMMENT ON COLUMN public.financial_entries.event_date IS 'Data do evento (ex.: dia da falta); irrelevante para diária.';
COMMENT ON COLUMN public.financial_entries.apuracao_start IS 'Início do ciclo seg–dom apurado (falta: semana do evento).';
COMMENT ON COLUMN public.financial_entries.apuracao_end IS 'Fim do ciclo apurado.';

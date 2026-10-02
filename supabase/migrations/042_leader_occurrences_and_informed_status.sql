-- Parte A: ocorrências de escala (falta/folga/cobertura) + status informativo

ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS occurrence_kind text,
  ADD COLUMN IF NOT EXISTS coverage_of_entry_id uuid REFERENCES public.financial_entries(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.financial_entries.occurrence_kind IS 'unexcused | day_off — tipo de ocorrência de escala (portal líder)';
COMMENT ON COLUMN public.financial_entries.coverage_of_entry_id IS 'Diária de cobertura aponta para o lançamento informativo do ausente';

CREATE INDEX IF NOT EXISTS idx_financial_entries_coverage_of
  ON public.financial_entries(coverage_of_entry_id)
  WHERE coverage_of_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_financial_entries_occurrence_kind
  ON public.financial_entries(workspace_id, occurrence_kind)
  WHERE occurrence_kind IS NOT NULL;

-- status `informed` é valor textual (sem CHECK rígido no legado)

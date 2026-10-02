-- Document contracted_daily on financial_entries.occurrence_kind (no schema change).
COMMENT ON COLUMN public.financial_entries.occurrence_kind IS
  'unexcused | day_off | contracted_daily — tipo de ocorrência de escala (portal líder / financeiro)';

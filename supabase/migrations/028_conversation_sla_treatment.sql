-- Prazo explícito de SLA de tratamento (entre 1ª resposta e resolução), alinhado ao queue SLA e à UI de etapas.
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS sla_treatment_deadline timestamptz;

-- CRM Comercial: sócio/administrador, endereço da loja, solicitações de dados (formulário público)

ALTER TABLE public.commercial_leads
  ADD COLUMN IF NOT EXISTS legal_representative_name text,
  ADD COLUMN IF NOT EXISTS legal_representative_cpf text,
  ADD COLUMN IF NOT EXISTS legal_representative_email text,
  ADD COLUMN IF NOT EXISTS legal_representative_phone text,
  ADD COLUMN IF NOT EXISTS address_cep text,
  ADD COLUMN IF NOT EXISTS address_street text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_neighborhood text,
  ADD COLUMN IF NOT EXISTS address_complement text;

CREATE TABLE IF NOT EXISTS public.commercial_data_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.commercial_leads(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'submitted', 'expired', 'cancelled')),
  required_fields jsonb NOT NULL DEFAULT '[]'::jsonb,
  expires_at timestamptz NOT NULL,
  submitted_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_data_requests_lead
  ON public.commercial_data_requests(lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commercial_data_requests_token
  ON public.commercial_data_requests(token_hash);

-- Novos tipos de atividade (formulário contrato)
ALTER TABLE public.commercial_lead_activities
  DROP CONSTRAINT IF EXISTS commercial_lead_activities_activity_type_check;

ALTER TABLE public.commercial_lead_activities
  ADD CONSTRAINT commercial_lead_activities_activity_type_check
  CHECK (activity_type IN (
    'stage_change', 'message', 'proposal', 'note', 'meeting', 'loss', 'won',
    'data_request_sent', 'data_request_completed'
  ));

ALTER TABLE public.commercial_data_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.commercial_data_requests;
CREATE POLICY service_role_all ON public.commercial_data_requests
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.commercial_data_requests DISABLE ROW LEVEL SECURITY;

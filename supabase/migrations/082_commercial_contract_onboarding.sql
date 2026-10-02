-- CRM Comercial: onboarding de contrato (formulário lead + complemento vendedor) e notificações

ALTER TABLE public.commercial_leads
  ADD COLUMN IF NOT EXISTS contact_expedition_name text,
  ADD COLUMN IF NOT EXISTS contact_expedition_phone text,
  ADD COLUMN IF NOT EXISTS contact_financial_name text,
  ADD COLUMN IF NOT EXISTS contact_financial_phone text,
  ADD COLUMN IF NOT EXISTS contract_onboarding jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.commercial_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type text NOT NULL,
  title text NOT NULL,
  body text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_notifications_user_created
  ON public.commercial_notifications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_commercial_notifications_workspace
  ON public.commercial_notifications(workspace_id, created_at DESC);

ALTER TABLE public.commercial_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.commercial_notifications;
CREATE POLICY service_role_all ON public.commercial_notifications
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

ALTER TABLE public.commercial_notifications DISABLE ROW LEVEL SECURITY;

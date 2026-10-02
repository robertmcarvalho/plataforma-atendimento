-- CRM Comercial: leads, pipeline, propostas e vínculo com conversas/contatos

CREATE TABLE IF NOT EXISTS public.commercial_pipeline_stages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#6366f1',
  probability_pct integer NOT NULL DEFAULT 0 CHECK (probability_pct >= 0 AND probability_pct <= 100),
  is_won boolean NOT NULL DEFAULT false,
  is_lost boolean NOT NULL DEFAULT false,
  is_entry boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_stages_one_entry
  ON public.commercial_pipeline_stages(workspace_id) WHERE is_entry = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_stages_one_won
  ON public.commercial_pipeline_stages(workspace_id) WHERE is_won = true;
CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_stages_one_lost
  ON public.commercial_pipeline_stages(workspace_id) WHERE is_lost = true;
CREATE INDEX IF NOT EXISTS idx_commercial_stages_workspace_sort
  ON public.commercial_pipeline_stages(workspace_id, sort_order);

CREATE TABLE IF NOT EXISTS public.commercial_loss_reasons (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_loss_reasons_workspace
  ON public.commercial_loss_reasons(workspace_id, sort_order);

CREATE TABLE IF NOT EXISTS public.commercial_field_definitions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text' CHECK (field_type IN ('text', 'number', 'select', 'date', 'boolean')),
  required boolean NOT NULL DEFAULT false,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS public.commercial_leads (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stage_id uuid NOT NULL REFERENCES public.commercial_pipeline_stages(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES public.users(id) ON DELETE RESTRICT,
  trade_name text NOT NULL,
  legal_name text,
  cnpj text NOT NULL,
  phone text NOT NULL,
  contact_name text NOT NULL,
  contact_email text,
  contact_role text,
  city text NOT NULL,
  state text NOT NULL,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'instagram', 'indicacao', 'whatsapp', 'campanha', 'referral', 'other')),
  notes text,
  campaign text,
  monthly_deliveries integer,
  drivers_count integer,
  erp text,
  custom_fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  deal_value_cents bigint,
  expected_close_at date,
  ai_score integer CHECK (ai_score IS NULL OR (ai_score >= 0 AND ai_score <= 100)),
  lead_temperature text CHECK (lead_temperature IS NULL OR lead_temperature IN ('frio', 'morno', 'quente', 'urgente')),
  loss_reason_id uuid REFERENCES public.commercial_loss_reasons(id) ON DELETE SET NULL,
  loss_notes text,
  converted_pharmacy_id uuid REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  primary_conversation_id uuid,
  last_message_at timestamptz,
  tags text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, cnpj)
);

CREATE INDEX IF NOT EXISTS idx_commercial_leads_workspace_stage
  ON public.commercial_leads(workspace_id, stage_id);
CREATE INDEX IF NOT EXISTS idx_commercial_leads_workspace_owner
  ON public.commercial_leads(workspace_id, owner_id);
CREATE INDEX IF NOT EXISTS idx_commercial_leads_workspace_updated
  ON public.commercial_leads(workspace_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_commercial_leads_workspace_cnpj
  ON public.commercial_leads(workspace_id, cnpj);
CREATE INDEX IF NOT EXISTS idx_commercial_leads_workspace_phone
  ON public.commercial_leads(workspace_id, phone);

CREATE TABLE IF NOT EXISTS public.commercial_lead_activities (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.commercial_leads(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN ('stage_change', 'message', 'proposal', 'note', 'meeting', 'loss', 'won')),
  title text NOT NULL,
  detail text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_activities_lead
  ON public.commercial_lead_activities(lead_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.commercial_proposals (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.commercial_leads(id) ON DELETE CASCADE,
  version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'sent', 'accepted')),
  package_name text NOT NULL,
  setup_cents bigint NOT NULL DEFAULT 0,
  monthly_cents bigint NOT NULL DEFAULT 0,
  mdr_pct numeric(5,2) NOT NULL DEFAULT 0,
  notes text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_commercial_proposals_lead
  ON public.commercial_proposals(lead_id, version DESC);

ALTER TABLE public.commercial_leads
  ADD CONSTRAINT commercial_leads_primary_conversation_fkey
  FOREIGN KEY (primary_conversation_id) REFERENCES public.conversations(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS context_commercial_lead_id uuid
  REFERENCES public.commercial_leads(id) ON DELETE SET NULL;

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS commercial_lead_id uuid
  REFERENCES public.commercial_leads(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_commercial_lead
  ON public.conversations(workspace_id, context_commercial_lead_id)
  WHERE context_commercial_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_commercial_lead
  ON public.contacts(workspace_id, commercial_lead_id)
  WHERE commercial_lead_id IS NOT NULL;

-- RLS para tabelas novas (035 não cobre tabelas criadas depois)
ALTER TABLE public.commercial_pipeline_stages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_loss_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_field_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_lead_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_proposals ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'commercial_pipeline_stages',
    'commercial_loss_reasons',
    'commercial_field_definitions',
    'commercial_leads',
    'commercial_lead_activities',
    'commercial_proposals'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_member_access ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_member_access ON public.%I
       FOR ALL TO authenticated
       USING (
         EXISTS (
           SELECT 1 FROM public.workspace_memberships wm
           WHERE wm.workspace_id = %I.workspace_id
             AND wm.user_id = auth.uid()
             AND wm.is_active = true
         )
       )
       WITH CHECK (
         EXISTS (
           SELECT 1 FROM public.workspace_memberships wm
           WHERE wm.workspace_id = %I.workspace_id
             AND wm.user_id = auth.uid()
             AND wm.is_active = true
         )
       )',
      t, t, t
    );
  END LOOP;
END $$;

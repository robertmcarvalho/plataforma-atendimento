-- MIGRATION 021 — Fundação SaaS multi-workspace
-- Objetivo:
-- - Introduzir workspaces e memberships
-- - Backfill do workspace padrão atual
-- - Tenantizar settings, canais e entidades raiz

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE IF NOT EXISTS public.workspaces (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug text NOT NULL UNIQUE,
  display_name text NOT NULL,
  cnpj text,
  logo_url text,
  timezone text NOT NULL DEFAULT 'America/Sao_Paulo',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS platform_role text NOT NULL DEFAULT 'member'
  CHECK (platform_role IN ('member', 'platform_admin', 'platform_owner'));

CREATE TABLE IF NOT EXISTS public.workspace_memberships (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_user_id
  ON public.workspace_memberships(user_id);

CREATE INDEX IF NOT EXISTS idx_workspace_memberships_workspace_id
  ON public.workspace_memberships(workspace_id);

CREATE TABLE IF NOT EXISTS public.workspace_channels (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel_type text NOT NULL CHECK (channel_type IN ('whatsapp', 'instagram', 'email', 'webchat')),
  provider text NOT NULL,
  display_name text,
  external_id text,
  verify_token text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  credentials jsonb NOT NULL DEFAULT '{}'::jsonb,
  health jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_workspace_channels_workspace_type
  ON public.workspace_channels(workspace_id, channel_type);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_channels_identity
  ON public.workspace_channels(workspace_id, channel_type, provider, external_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_workspace_channels_default
  ON public.workspace_channels(workspace_id, channel_type)
  WHERE is_default = true;

INSERT INTO public.workspaces (slug, display_name, cnpj, logo_url, timezone)
SELECT
  'default',
  COALESCE(
    (SELECT trim(both '"' from value::text) FROM public.app_settings WHERE key = 'workspace_display_name' LIMIT 1),
    'Flux Farma'
  ),
  COALESCE((SELECT trim(both '"' from value::text) FROM public.app_settings WHERE key = 'workspace_cnpj' LIMIT 1), ''),
  NULLIF((SELECT trim(both '"' from value::text) FROM public.app_settings WHERE key = 'workspace_logo_url' LIMIT 1), ''),
  COALESCE(
    (SELECT trim(both '"' from value::text) FROM public.app_settings WHERE key = 'workspace_timezone' LIMIT 1),
    'America/Sao_Paulo'
  )
WHERE NOT EXISTS (SELECT 1 FROM public.workspaces WHERE slug = 'default');

UPDATE public.users
SET platform_role = 'platform_admin'
WHERE platform_role = 'member'
  AND role_id IN (
    SELECT id FROM public.roles WHERE name = 'admin'
  );

INSERT INTO public.workspace_memberships (workspace_id, user_id, role_id, is_active, is_default)
SELECT
  w.id,
  u.id,
  u.role_id,
  u.is_active,
  true
FROM public.users u
CROSS JOIN LATERAL (
  SELECT id
  FROM public.workspaces
  ORDER BY created_at
  LIMIT 1
) w
ON CONFLICT (workspace_id, user_id) DO UPDATE
SET
  role_id = EXCLUDED.role_id,
  is_active = EXCLUDED.is_active,
  is_default = true,
  updated_at = now();

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.app_settings
SET workspace_id = (
  SELECT id
  FROM public.workspaces
  ORDER BY created_at
  LIMIT 1
)
WHERE workspace_id IS NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'app_settings'
      AND constraint_name = 'app_settings_pkey'
  ) THEN
    ALTER TABLE public.app_settings DROP CONSTRAINT app_settings_pkey;
  END IF;
END $$;

ALTER TABLE public.app_settings
  ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_pkey PRIMARY KEY (workspace_id, key);

ALTER TABLE public.contacts
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.internal_notes
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.internal_chat_messages
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.conversation_assignments
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.bot_sessions
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.routing_rules
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.bot_flows
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.sla_policies
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.sla_events
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.campaign_recipients
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.campaign_dispatch_logs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.automation_rules
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.automation_runs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.financial_entries
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.financial_installments
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.financial_exports
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.api_tokens
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.user_sectors
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.pharmacy_sector_attendants
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
ALTER TABLE public.ticket_events
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.contacts
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.conversations c
SET workspace_id = COALESCE(
  c.workspace_id,
  (SELECT workspace_id FROM public.contacts ct WHERE ct.id = c.contact_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE c.workspace_id IS NULL;

UPDATE public.messages m
SET workspace_id = COALESCE(
  m.workspace_id,
  (SELECT workspace_id FROM public.conversations c WHERE c.id = m.conversation_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE m.workspace_id IS NULL;

UPDATE public.internal_notes n
SET workspace_id = COALESCE(
  n.workspace_id,
  (SELECT workspace_id FROM public.conversations c WHERE c.id = n.conversation_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE n.workspace_id IS NULL;

UPDATE public.internal_chat_messages m
SET workspace_id = COALESCE(
  m.workspace_id,
  (SELECT workspace_id FROM public.conversations c WHERE c.id = m.conversation_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE m.workspace_id IS NULL;

UPDATE public.conversation_assignments a
SET workspace_id = COALESCE(
  a.workspace_id,
  (SELECT workspace_id FROM public.conversations c WHERE c.id = a.conversation_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE a.workspace_id IS NULL;

UPDATE public.bot_sessions s
SET workspace_id = COALESCE(
  s.workspace_id,
  (SELECT workspace_id FROM public.contacts c WHERE c.id = s.contact_id),
  (SELECT workspace_id FROM public.conversations c WHERE c.id = s.conversation_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE s.workspace_id IS NULL;

UPDATE public.routing_rules
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.bot_flows
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.sla_policies
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.sla_events e
SET workspace_id = COALESCE(
  e.workspace_id,
  (SELECT workspace_id FROM public.conversations c WHERE c.id = e.conversation_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE e.workspace_id IS NULL;

UPDATE public.message_templates
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.campaigns
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.campaign_recipients r
SET workspace_id = COALESCE(
  r.workspace_id,
  (SELECT workspace_id FROM public.campaigns c WHERE c.id = r.campaign_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE r.workspace_id IS NULL;

UPDATE public.campaign_dispatch_logs l
SET workspace_id = COALESCE(
  l.workspace_id,
  (SELECT workspace_id FROM public.campaigns c WHERE c.id = l.campaign_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE l.workspace_id IS NULL;

UPDATE public.automation_rules
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.automation_runs r
SET workspace_id = COALESCE(
  r.workspace_id,
  (SELECT workspace_id FROM public.automation_rules ar WHERE ar.id = r.rule_id),
  (SELECT workspace_id FROM public.campaigns c WHERE c.id = r.campaign_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE r.workspace_id IS NULL;

UPDATE public.financial_entries
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.financial_installments i
SET workspace_id = COALESCE(
  i.workspace_id,
  (SELECT workspace_id FROM public.financial_entries e WHERE e.id = i.entry_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE i.workspace_id IS NULL;

UPDATE public.financial_exports
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.api_tokens
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.audit_logs
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.user_sectors
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.pharmacy_sector_attendants
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

UPDATE public.tickets
SET workspace_id = COALESCE(
  workspace_id,
  tenant_id,
  (SELECT workspace_id FROM public.conversations c WHERE c.id = tickets.conversation_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE workspace_id IS NULL;

UPDATE public.ticket_events e
SET workspace_id = COALESCE(
  e.workspace_id,
  (SELECT workspace_id FROM public.tickets t WHERE t.id = e.ticket_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE e.workspace_id IS NULL;

ALTER TABLE public.contacts ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.conversations ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.messages ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.bot_sessions ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.routing_rules ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.bot_flows ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.sla_policies ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.message_templates ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.campaigns ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.campaign_recipients ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.automation_rules ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.automation_runs ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.financial_entries ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.financial_installments ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.user_sectors ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_wa_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_workspace_phone_unique
  ON public.contacts(workspace_id, wa_phone);

ALTER TABLE public.leaders ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
UPDATE public.leaders
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;
ALTER TABLE public.leaders ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.leaders DROP CONSTRAINT IF EXISTS leaders_phone_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_leaders_workspace_phone_unique
  ON public.leaders(workspace_id, phone);

ALTER TABLE public.pharmacies ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
UPDATE public.pharmacies
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;
ALTER TABLE public.pharmacies ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.pharmacies DROP CONSTRAINT IF EXISTS pharmacies_cnpj_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pharmacies_workspace_cnpj_unique
  ON public.pharmacies(workspace_id, cnpj)
  WHERE cnpj IS NOT NULL;

ALTER TABLE public.drivers ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
UPDATE public.drivers
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;
ALTER TABLE public.drivers ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_phone_key;
ALTER TABLE public.drivers DROP CONSTRAINT IF EXISTS drivers_cpf_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_workspace_phone_unique
  ON public.drivers(workspace_id, phone);
CREATE UNIQUE INDEX IF NOT EXISTS idx_drivers_workspace_cpf_unique
  ON public.drivers(workspace_id, cpf)
  WHERE cpf IS NOT NULL;

ALTER TABLE public.driver_pharmacy_links
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
UPDATE public.driver_pharmacy_links l
SET workspace_id = COALESCE(
  l.workspace_id,
  (SELECT workspace_id FROM public.drivers d WHERE d.id = l.driver_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE workspace_id IS NULL;
ALTER TABLE public.driver_pharmacy_links ALTER COLUMN workspace_id SET NOT NULL;

ALTER TABLE public.leader_pharmacy_links
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;
UPDATE public.leader_pharmacy_links l
SET workspace_id = COALESCE(
  l.workspace_id,
  (SELECT workspace_id FROM public.leaders d WHERE d.id = l.leader_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE workspace_id IS NULL;
ALTER TABLE public.leader_pharmacy_links ALTER COLUMN workspace_id SET NOT NULL;

INSERT INTO public.workspace_channels (
  workspace_id,
  channel_type,
  provider,
  display_name,
  external_id,
  verify_token,
  config,
  credentials,
  health,
  is_active,
  is_default
)
SELECT
  w.id,
  'whatsapp',
  'meta_cloud',
  'WhatsApp principal',
  NULLIF(current_setting('app.settings.meta_phone_number_id', true), ''),
  NULLIF(current_setting('app.settings.meta_verify_token', true), ''),
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  true,
  true
FROM public.workspaces w
WHERE w.slug = 'default'
  AND NOT EXISTS (
    SELECT 1
    FROM public.workspace_channels c
    WHERE c.workspace_id = w.id
      AND c.channel_type = 'whatsapp'
      AND c.provider = 'meta_cloud'
      AND c.is_default = true
  );

CREATE INDEX IF NOT EXISTS idx_contacts_workspace_id ON public.contacts(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversations_workspace_id ON public.conversations(workspace_id);
CREATE INDEX IF NOT EXISTS idx_messages_workspace_id ON public.messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_campaigns_workspace_id ON public.campaigns(workspace_id);
CREATE INDEX IF NOT EXISTS idx_automation_rules_workspace_id ON public.automation_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_tickets_workspace_id ON public.tickets(workspace_id);

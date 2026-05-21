-- MIGRATION 022 — Catálogos de atendimento por workspace

CREATE TABLE IF NOT EXISTS public.workspace_profiles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS public.workspace_visible_sectors (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  sector_key text NOT NULL,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL,
  display_name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, sector_key)
);

CREATE TABLE IF NOT EXISTS public.workspace_sector_demands (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  profile_code text NOT NULL,
  sector_key text NOT NULL,
  demand_key text NOT NULL,
  title text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, demand_key)
);

CREATE TABLE IF NOT EXISTS public.workspace_demand_rules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  demand_key text NOT NULL,
  requires_pharmacy boolean NOT NULL DEFAULT false,
  route_to text,
  target_sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, demand_key)
);

CREATE TABLE IF NOT EXISTS public.workspace_flow_messages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  message_key text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  content text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, message_key, channel)
);

CREATE TABLE IF NOT EXISTS public.workspace_sla_rules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  demand_key text NOT NULL,
  profile_code text,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, demand_key, profile_code)
);

CREATE TABLE IF NOT EXISTS public.workspace_out_of_hours_rules (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  channel text NOT NULL DEFAULT 'whatsapp',
  is_active boolean NOT NULL DEFAULT false,
  message text NOT NULL,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, channel)
);

CREATE INDEX IF NOT EXISTS idx_workspace_profiles_workspace_id
  ON public.workspace_profiles(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_visible_sectors_workspace_id
  ON public.workspace_visible_sectors(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_sector_demands_workspace_id
  ON public.workspace_sector_demands(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_demand_rules_workspace_id
  ON public.workspace_demand_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_flow_messages_workspace_id
  ON public.workspace_flow_messages(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_sla_rules_workspace_id
  ON public.workspace_sla_rules(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_out_of_hours_rules_workspace_id
  ON public.workspace_out_of_hours_rules(workspace_id);

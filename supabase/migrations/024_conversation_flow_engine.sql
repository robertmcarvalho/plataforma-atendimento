-- MIGRATION 024 — Motor de fluxo versionado por workspace

CREATE TABLE IF NOT EXISTS public.conversation_flow_definitions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  slug text NOT NULL,
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, slug)
);

CREATE TABLE IF NOT EXISTS public.conversation_flow_versions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.conversation_flow_definitions(id) ON DELETE CASCADE,
  version_number int NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
  graph jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (definition_id, version_number)
);

CREATE TABLE IF NOT EXISTS public.conversation_flow_sessions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  bot_session_id uuid REFERENCES public.bot_sessions(id) ON DELETE SET NULL,
  flow_version_id uuid NOT NULL REFERENCES public.conversation_flow_versions(id) ON DELETE CASCADE,
  state jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_flow_definitions_workspace
  ON public.conversation_flow_definitions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversation_flow_versions_workspace
  ON public.conversation_flow_versions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversation_flow_versions_definition
  ON public.conversation_flow_versions(definition_id, status);
CREATE INDEX IF NOT EXISTS idx_conversation_flow_sessions_workspace
  ON public.conversation_flow_sessions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_conversation_flow_sessions_conversation
  ON public.conversation_flow_sessions(conversation_id);

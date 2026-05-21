-- Liga fluxos versionados a canais e gatilhos (mensagem / keyword / conversation_started).

CREATE TABLE IF NOT EXISTS public.conversation_flow_bindings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  definition_id uuid NOT NULL REFERENCES public.conversation_flow_definitions(id) ON DELETE CASCADE,
  workspace_channel_id uuid REFERENCES public.workspace_channels(id) ON DELETE SET NULL,
  trigger_type text NOT NULL DEFAULT 'message_received'
    CHECK (trigger_type IN ('conversation_started', 'message_received', 'keyword')),
  keywords text[] NOT NULL DEFAULT ARRAY[]::text[],
  priority int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_flow_bindings_workspace_def
  ON public.conversation_flow_bindings(workspace_id, definition_id);

CREATE INDEX IF NOT EXISTS idx_conversation_flow_bindings_channel
  ON public.conversation_flow_bindings(workspace_id, workspace_channel_id)
  WHERE workspace_channel_id IS NOT NULL;

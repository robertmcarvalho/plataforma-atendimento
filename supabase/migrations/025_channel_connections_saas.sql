-- 025 — Multi-conexão por workspace, platform settings, health em canais

CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_channels
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'error', 'draft'));

ALTER TABLE public.workspace_channels
  ADD COLUMN IF NOT EXISTS last_message_at timestamptz;

ALTER TABLE public.workspace_channels
  ADD COLUMN IF NOT EXISTS messages_24h integer NOT NULL DEFAULT 0;

ALTER TABLE public.workspace_channels
  ADD COLUMN IF NOT EXISTS slug text;

CREATE INDEX IF NOT EXISTS idx_workspace_channels_status
  ON public.workspace_channels(workspace_id, status);

COMMENT ON COLUMN public.workspace_channels.status IS 'active|paused|error|draft — UI revive';

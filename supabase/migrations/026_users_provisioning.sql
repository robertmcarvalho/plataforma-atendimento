-- 026 — Provisionamento de usuários, filas por canal, log de e-mail

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS username text;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS provisioned_at timestamptz;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_lower
  ON public.users (lower(username))
  WHERE username IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.user_channel_queue_assignments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  workspace_channel_id uuid NOT NULL REFERENCES public.workspace_channels(id) ON DELETE CASCADE,
  queue_name text NOT NULL DEFAULT 'default',
  is_enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, workspace_channel_id, queue_name)
);

CREATE INDEX IF NOT EXISTS idx_user_channel_assignments_workspace
  ON public.user_channel_queue_assignments(workspace_id, user_id);

CREATE TABLE IF NOT EXISTS public.email_delivery_log (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid REFERENCES public.workspaces(id) ON DELETE SET NULL,
  template_key text NOT NULL,
  recipient text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'queued')),
  error_message text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_email_delivery_log_workspace
  ON public.email_delivery_log(workspace_id, created_at DESC);

-- Link conversations to the operational channel/webhook that originated them.
-- Safe rollout: nullable column, FK SET NULL, and best-effort backfill only when a workspace has one active messaging channel.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS workspace_channel_id uuid REFERENCES public.workspace_channels(id) ON DELETE SET NULL;

WITH single_active_channel AS (
  SELECT workspace_id, MIN(id::text)::uuid AS workspace_channel_id
  FROM public.workspace_channels
  WHERE is_active = true
    AND channel_type IN ('whatsapp', 'instagram', 'email', 'webchat')
  GROUP BY workspace_id
  HAVING COUNT(*) = 1
)
UPDATE public.conversations c
SET workspace_channel_id = s.workspace_channel_id
FROM single_active_channel s
WHERE c.workspace_id = s.workspace_id
  AND c.workspace_channel_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_channel_status_last
  ON public.conversations(workspace_id, workspace_channel_id, status, last_message_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_channel_contact_open
  ON public.conversations(workspace_id, workspace_channel_id, contact_id, status)
  WHERE status IN ('open', 'pending');

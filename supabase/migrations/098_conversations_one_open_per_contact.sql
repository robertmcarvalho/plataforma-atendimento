-- BUG-001: uma conversa open/pending por contato no workspace.
-- Fecha duplicatas existentes (mantém a mais recente) antes do índice único.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, contact_id
      ORDER BY last_message_at DESC NULLS LAST, created_at DESC
    ) AS rn
  FROM public.conversations
  WHERE status IN ('open', 'pending')
    AND contact_id IS NOT NULL
)
UPDATE public.conversations c
SET
  status = 'resolved',
  close_reason = 'duplicate_merge_auto',
  resolved_at = COALESCE(c.resolved_at, now()),
  updated_at = now()
FROM ranked r
WHERE c.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS conversations_one_open_per_contact_idx
  ON public.conversations (workspace_id, contact_id)
  WHERE status IN ('open', 'pending') AND contact_id IS NOT NULL;

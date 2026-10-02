-- ==========================================================
-- MIGRATION 080 — Estado "lidas" do feed de notificações da inbox
-- ==========================================================

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS inbox_notifications_seen_at timestamptz;

COMMENT ON COLUMN public.users.inbox_notifications_seen_at IS
  'Cursor do feed de notificações da inbox (marcar todas como lidas).';

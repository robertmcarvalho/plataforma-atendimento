-- 032 — Vinculo WhatsApp do lider por OTP
-- Guarda tentativas de verificacao e status de posse do numero usado no portal do lider.

ALTER TABLE public.leaders
  ADD COLUMN IF NOT EXISTS whatsapp_verified_at timestamptz;

ALTER TABLE public.leaders
  ADD COLUMN IF NOT EXISTS whatsapp_session_revoked_at timestamptz;

CREATE TABLE IF NOT EXISTS public.leader_whatsapp_verifications (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  leader_id uuid NOT NULL REFERENCES public.leaders(id) ON DELETE CASCADE,
  phone_e164 text NOT NULL,
  code_hash text NOT NULL,
  attempts int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'verified', 'expired', 'failed')),
  expires_at timestamptz NOT NULL,
  verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_leader_whatsapp_verifications_leader
  ON public.leader_whatsapp_verifications(leader_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leader_whatsapp_verifications_workspace_phone
  ON public.leader_whatsapp_verifications(workspace_id, phone_e164, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_leader_whatsapp_verifications_pending
  ON public.leader_whatsapp_verifications(leader_id, status, expires_at)
  WHERE status = 'pending';

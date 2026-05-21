-- 027 — Motor de atendimento: metas de relatório, auditoria SLA, setor metadata

CREATE TABLE IF NOT EXISTS public.workspace_report_targets (
  workspace_id uuid PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.workspace_visible_sectors
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.workspace_sla_rules
  ADD COLUMN IF NOT EXISTS sector_key text;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS demand_key text;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS sla_applied_from text;

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS flow_version_id uuid
    REFERENCES public.conversation_flow_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_conversations_workspace_demand
  ON public.conversations(workspace_id, demand_key)
  WHERE demand_key IS NOT NULL;

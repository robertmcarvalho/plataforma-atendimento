-- CRM Comercial: perfis sales/commercial + snapshot operacional em propostas

-- 1. Roles comerciais por workspace
INSERT INTO public.roles (workspace_id, name, permissions)
SELECT w.id, 'commercial', '{
  "commercial": {"view": true, "manage": true},
  "conversations": {"view": true, "reply": true}
}'::jsonb
FROM public.workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles r WHERE r.workspace_id = w.id AND r.name = 'commercial'
);

INSERT INTO public.roles (workspace_id, name, permissions)
SELECT w.id, 'sales', '{
  "commercial": {"view": true, "manage": true},
  "conversations": {"view": true, "reply": true}
}'::jsonb
FROM public.workspaces w
WHERE NOT EXISTS (
  SELECT 1 FROM public.roles r WHERE r.workspace_id = w.id AND r.name = 'sales'
);

-- 2. Snapshot operacional e PDF em propostas
ALTER TABLE public.commercial_proposals
  ADD COLUMN IF NOT EXISTS operational_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS pdf_generated_at timestamptz;

ALTER TABLE public.commercial_leads
  ADD COLUMN IF NOT EXISTS operational_snapshot jsonb;

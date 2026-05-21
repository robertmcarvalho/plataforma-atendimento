-- MIGRATION 023 — Roles e setores por workspace

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.roles
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

ALTER TABLE public.roles
  ALTER COLUMN workspace_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_roles_workspace_name_unique
  ON public.roles(workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_roles_workspace_id
  ON public.roles(workspace_id);

ALTER TABLE public.sectors
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.sectors
SET workspace_id = (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
WHERE workspace_id IS NULL;

ALTER TABLE public.sectors
  ALTER COLUMN workspace_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_sectors_workspace_name_unique
  ON public.sectors(workspace_id, name);

CREATE INDEX IF NOT EXISTS idx_sectors_workspace_id
  ON public.sectors(workspace_id);

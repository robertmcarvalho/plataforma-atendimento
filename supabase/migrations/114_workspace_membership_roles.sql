-- Papéis múltiplos por membro de workspace (opção A: gestor operacional + financeiro, etc.)

CREATE TABLE IF NOT EXISTS public.workspace_membership_roles (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id, role_id)
);

CREATE INDEX IF NOT EXISTS idx_workspace_membership_roles_user
  ON public.workspace_membership_roles(workspace_id, user_id);

-- Backfill a partir do papel único legado em workspace_memberships
INSERT INTO public.workspace_membership_roles (workspace_id, user_id, role_id, is_primary)
SELECT wm.workspace_id, wm.user_id, wm.role_id, true
FROM public.workspace_memberships wm
WHERE wm.role_id IS NOT NULL
  AND wm.is_active IS NOT DISTINCT FROM true
ON CONFLICT (workspace_id, user_id, role_id) DO NOTHING;

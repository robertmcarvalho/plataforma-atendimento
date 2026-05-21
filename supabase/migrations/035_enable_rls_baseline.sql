-- Baseline RLS para governança multi-tenant.
-- O backend com service role continua bypassando RLS; acessos diretos authenticated ficam limitados por membership.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_schema, c.table_name
    FROM information_schema.columns c
    JOIN pg_class pc ON pc.relname = c.table_name
    JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
    WHERE c.table_schema = 'public'
      AND c.column_name = 'workspace_id'
      AND pc.relkind = 'r'
      AND c.table_name <> 'workspace_memberships'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS tenant_member_access ON %I.%I', r.table_schema, r.table_name);
    EXECUTE format(
      'CREATE POLICY tenant_member_access ON %I.%I
       FOR ALL TO authenticated
       USING (
         EXISTS (
           SELECT 1
           FROM public.workspace_memberships wm
           WHERE wm.workspace_id = %I.workspace_id
             AND wm.user_id = auth.uid()
             AND wm.is_active = true
         )
       )
       WITH CHECK (
         EXISTS (
           SELECT 1
           FROM public.workspace_memberships wm
           WHERE wm.workspace_id = %I.workspace_id
             AND wm.user_id = auth.uid()
             AND wm.is_active = true
         )
       )',
      r.table_schema,
      r.table_name,
      r.table_name,
      r.table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS workspace_memberships_self_read ON public.workspace_memberships;
CREATE POLICY workspace_memberships_self_read ON public.workspace_memberships
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS workspaces_member_read ON public.workspaces;
CREATE POLICY workspaces_member_read ON public.workspaces
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.workspace_memberships wm
      WHERE wm.workspace_id = workspaces.id
        AND wm.user_id = auth.uid()
        AND wm.is_active = true
    )
  );

DROP POLICY IF EXISTS users_self_read ON public.users;
CREATE POLICY users_self_read ON public.users
  FOR SELECT TO authenticated
  USING (id = auth.uid());

DROP POLICY IF EXISTS service_role_all_workspaces ON public.workspaces;
CREATE POLICY service_role_all_workspaces ON public.workspaces
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_users ON public.users;
CREATE POLICY service_role_all_users ON public.users
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS service_role_all_memberships ON public.workspace_memberships;
CREATE POLICY service_role_all_memberships ON public.workspace_memberships
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

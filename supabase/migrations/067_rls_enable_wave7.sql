-- Wave 7 RLS rollout (staging): canais, memberships, pharmacy attendants e imports financeiros.
-- workspace_memberships usa policy self (evita circularidade com tenant_member_access).
-- Requer smoke:rls-wave7 após aplicar.

CREATE OR REPLACE FUNCTION public.ensure_tenant_rls_policies(p_table text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  EXECUTE format('DROP POLICY IF EXISTS tenant_member_access ON public.%I', p_table);
  EXECUTE format(
    'CREATE POLICY tenant_member_access ON public.%I
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
    p_table,
    p_table,
    p_table
  );

  EXECUTE format('DROP POLICY IF EXISTS service_role_all ON public.%I', p_table);
  EXECUTE format(
    'CREATE POLICY service_role_all ON public.%I
       FOR ALL TO service_role
       USING (true)
       WITH CHECK (true)',
    p_table
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_workspace_memberships_rls_policies()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DROP POLICY IF EXISTS tenant_member_access ON public.workspace_memberships;
  DROP POLICY IF EXISTS workspace_memberships_self_read ON public.workspace_memberships;
  DROP POLICY IF EXISTS workspace_memberships_self_access ON public.workspace_memberships;

  CREATE POLICY workspace_memberships_self_access ON public.workspace_memberships
    FOR ALL TO authenticated
    USING (user_id = auth.uid())
    WITH CHECK (user_id = auth.uid());

  DROP POLICY IF EXISTS service_role_all ON public.workspace_memberships;
  DROP POLICY IF EXISTS service_role_all_memberships ON public.workspace_memberships;
  CREATE POLICY service_role_all ON public.workspace_memberships
    FOR ALL TO service_role
    USING (true)
    WITH CHECK (true);
END;
$$;

DO $$
DECLARE
  t text;
  wave7 text[] := ARRAY[
    'workspace_channels',
    'workspace_memberships',
    'pharmacy_sector_attendants',
    'financial_imports',
    'financial_import_rows'
  ];
  risk text;
BEGIN
  FOREACH t IN ARRAY wave7
  LOOP
    IF t = 'workspace_memberships' THEN
      PERFORM public.ensure_workspace_memberships_rls_policies();
    ELSE
      PERFORM public.ensure_tenant_rls_policies(t);
    END IF;

    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);

    risk := CASE
      WHEN t IN ('workspace_channels', 'workspace_memberships') THEN 'high'
      ELSE 'medium'
    END;

    INSERT INTO public.rls_rollout_control (table_name, desired_state, risk_level, owner, rollout_notes, validated_at, updated_at)
    VALUES (
      t,
      'enabled_staging',
      risk,
      'platform',
      'Wave 7 — canais/memberships/imports; validar com smoke:rls-wave7.',
      now(),
      now()
    )
    ON CONFLICT (table_name) DO UPDATE
    SET
      desired_state = 'enabled_staging',
      risk_level = EXCLUDED.risk_level,
      rollout_notes = EXCLUDED.rollout_notes,
      validated_at = now(),
      updated_at = now();
  END LOOP;
END $$;

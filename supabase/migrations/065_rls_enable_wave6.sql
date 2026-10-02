-- Wave 6 RLS rollout (staging): notas internas, SLA events, tickets events e user_sectors.
-- Requer smoke:rls-wave6 após aplicar.

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

DO $$
DECLARE
  t text;
  wave6 text[] := ARRAY[
    'internal_notes',
    'internal_chat_messages',
    'ticket_events',
    'sla_events',
    'user_sectors'
  ];
BEGIN
  FOREACH t IN ARRAY wave6
  LOOP
    PERFORM public.ensure_tenant_rls_policies(t);
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    INSERT INTO public.rls_rollout_control (table_name, desired_state, risk_level, owner, rollout_notes, validated_at, updated_at)
    VALUES (
      t,
      'enabled_staging',
      'medium',
      'platform',
      'Wave 6 — notas/SLA/ticket events/user_sectors; validar com smoke:rls-wave6.',
      now(),
      now()
    )
    ON CONFLICT (table_name) DO UPDATE
    SET
      desired_state = 'enabled_staging',
      rollout_notes = EXCLUDED.rollout_notes,
      validated_at = now(),
      updated_at = now();
  END LOOP;
END $$;

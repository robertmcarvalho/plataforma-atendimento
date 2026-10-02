-- Rollback wave 10 RLS.

DO $$
DECLARE
  t text;
  wave10 text[] := ARRAY[
    'workspace_profiles',
    'workspace_visible_sectors',
    'workspace_sector_demands',
    'workspace_demand_rules',
    'workspace_flow_messages'
  ];
BEGIN
  FOREACH t IN ARRAY wave10
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

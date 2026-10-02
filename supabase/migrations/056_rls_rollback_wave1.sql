-- Rollback wave 1 RLS (desabilita enforcement; mantém policies para reativação).

DO $$
DECLARE
  t text;
  wave1 text[] := ARRAY[
    'app_settings',
    'roles',
    'sectors',
    'automation_rules',
    'routing_rules'
  ];
BEGIN
  FOREACH t IN ARRAY wave1
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

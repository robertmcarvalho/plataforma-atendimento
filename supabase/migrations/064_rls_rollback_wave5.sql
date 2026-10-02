-- Rollback wave 5 RLS (desabilita enforcement; mantém policies para reativação).

DO $$
DECLARE
  t text;
  wave5 text[] := ARRAY[
    'conversation_flow_definitions',
    'conversation_flow_versions',
    'conversation_flow_bindings',
    'conversation_flow_sessions',
    'conversation_assignments'
  ];
BEGIN
  FOREACH t IN ARRAY wave5
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

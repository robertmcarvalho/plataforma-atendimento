-- Rollback wave 9 RLS.

DO $$
DECLARE
  t text;
  wave9 text[] := ARRAY[
    'contacts',
    'conversations',
    'messages',
    'financial_entries',
    'pending_tasks'
  ];
BEGIN
  FOREACH t IN ARRAY wave9
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

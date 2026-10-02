-- Rollback wave 3 RLS (desabilita enforcement; mantém policies para reativação).

DO $$
DECLARE
  t text;
  wave3 text[] := ARRAY[
    'campaigns',
    'campaign_recipients',
    'campaign_dispatch_logs',
    'automation_runs',
    'bot_sessions'
  ];
BEGIN
  FOREACH t IN ARRAY wave3
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

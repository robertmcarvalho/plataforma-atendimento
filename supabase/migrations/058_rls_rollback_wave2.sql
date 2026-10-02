-- Rollback wave 2 RLS (desabilita enforcement; mantém policies para reativação).

DO $$
DECLARE
  t text;
  wave2 text[] := ARRAY[
    'sla_policies',
    'bot_flows',
    'message_templates',
    'api_tokens',
    'audit_logs'
  ];
BEGIN
  FOREACH t IN ARRAY wave2
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

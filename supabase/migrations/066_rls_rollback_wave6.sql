-- Rollback wave 6 RLS (desabilita enforcement; mantém policies para reativação).

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
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

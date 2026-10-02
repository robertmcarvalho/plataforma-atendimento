-- Rollback wave 8 RLS (desabilita enforcement; mantém policies para reativação).

DO $$
DECLARE
  t text;
  wave8 text[] := ARRAY[
    'financial_exports',
    'financial_installments',
    'email_delivery_log',
    'supply_requests',
    'tickets'
  ];
BEGIN
  FOREACH t IN ARRAY wave8
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

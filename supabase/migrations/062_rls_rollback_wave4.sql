-- Rollback wave 4 RLS (desabilita enforcement; mantém policies para reativação).

DO $$
DECLARE
  t text;
  wave4 text[] := ARRAY[
    'leaders',
    'pharmacies',
    'drivers',
    'driver_pharmacy_links',
    'leader_pharmacy_links'
  ];
BEGIN
  FOREACH t IN ARRAY wave4
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

-- Rollback wave 7 RLS (desabilita enforcement; mantém policies para reativação).

DO $$
DECLARE
  t text;
  wave7 text[] := ARRAY[
    'workspace_channels',
    'workspace_memberships',
    'pharmacy_sector_attendants',
    'financial_imports',
    'financial_import_rows'
  ];
BEGIN
  FOREACH t IN ARRAY wave7
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

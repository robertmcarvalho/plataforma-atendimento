-- Rollback wave 11 RLS.

DO $$
DECLARE
  t text;
  wave11 text[] := ARRAY[
    'commercial_pipeline_stages',
    'commercial_loss_reasons',
    'commercial_field_definitions',
    'commercial_leads',
    'commercial_lead_activities',
    'commercial_proposals',
    'commercial_data_requests',
    'commercial_erp_options'
  ];
BEGIN
  FOREACH t IN ARRAY wave11
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

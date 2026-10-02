-- Comercial: políticas service_role (backend) + alinhamento com rollout 036 (RLS off até validação).
-- Evita timeouts no PostgREST quando só existia policy TO authenticated (047).

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'commercial_pipeline_stages',
    'commercial_loss_reasons',
    'commercial_field_definitions',
    'commercial_leads',
    'commercial_lead_activities',
    'commercial_proposals'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS service_role_all ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY service_role_all ON public.%I
       FOR ALL TO service_role
       USING (true)
       WITH CHECK (true)',
      t
    );
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;

-- Rollback wave 12 RLS.

DO $$
DECLARE
  t text;
  wave12 text[] := ARRAY[
    'workspace_sla_rules',
    'workspace_out_of_hours_rules',
    'workspace_report_targets',
    'user_channel_queue_assignments',
    'leader_whatsapp_verifications',
    'processed_webhook_events'
  ];
BEGIN
  FOREACH t IN ARRAY wave12
  LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', t);
    UPDATE public.rls_rollout_control
    SET desired_state = 'rolled_back', updated_at = now()
    WHERE table_name = t;
  END LOOP;
END $$;

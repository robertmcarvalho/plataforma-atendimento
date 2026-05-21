-- Controle progressivo de RLS.
-- Mantém policies criadas na 035, mas desabilita enforcement global até validação em staging.
-- Rollout futuro: habilitar tabela a tabela após testes cross-tenant e rollback aprovado.

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DISABLE ROW LEVEL SECURITY', r.schemaname, r.tablename);
  END LOOP;
END $$;

CREATE TABLE IF NOT EXISTS public.rls_rollout_control (
  table_name text PRIMARY KEY,
  desired_state text NOT NULL DEFAULT 'prepared' CHECK (desired_state IN ('prepared', 'enabled_staging', 'enabled_production', 'rolled_back')),
  risk_level text NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low', 'medium', 'high', 'critical')),
  owner text NOT NULL DEFAULT 'platform',
  rollout_notes text,
  validated_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.rls_rollout_control (table_name, desired_state, risk_level, owner, rollout_notes)
SELECT
  c.table_name,
  'prepared',
  CASE
    WHEN c.table_name IN ('conversations', 'messages', 'contacts', 'tickets', 'financial_entries', 'pending_tasks') THEN 'critical'
    WHEN c.table_name LIKE 'workspace_%' THEN 'high'
    ELSE 'medium'
  END,
  'platform',
  'Policies preparadas; enforcement depende de validação cross-tenant em staging.'
FROM information_schema.columns c
JOIN pg_class pc ON pc.relname = c.table_name
JOIN pg_namespace pn ON pn.oid = pc.relnamespace AND pn.nspname = c.table_schema
WHERE c.table_schema = 'public'
  AND c.column_name = 'workspace_id'
  AND pc.relkind = 'r'
ON CONFLICT (table_name) DO UPDATE
SET
  desired_state = EXCLUDED.desired_state,
  risk_level = EXCLUDED.risk_level,
  rollout_notes = EXCLUDED.rollout_notes,
  updated_at = now();

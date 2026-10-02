-- Fase 4 — Relatórios mensais regulatórios (dev/staging only)

DO $$ BEGIN
  CREATE TYPE public.billing_monthly_report_kind AS ENUM (
    'inss_accounting',
    'insurance_active',
    'insurance_terminated'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.billing_monthly_report_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  report_kind     public.billing_monthly_report_kind NOT NULL,
  competence_month char(7) NOT NULL,
  cutoff_date     date,
  row_count       integer NOT NULL DEFAULT 0,
  total_cents     bigint,
  sent_at         timestamptz,
  sent_by         uuid REFERENCES public.users(id) ON DELETE SET NULL,
  metadata        jsonb NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_monthly_report_runs_unique UNIQUE (workspace_id, report_kind, competence_month)
);

CREATE INDEX IF NOT EXISTS idx_billing_monthly_report_runs_workspace
  ON public.billing_monthly_report_runs (workspace_id, competence_month DESC);

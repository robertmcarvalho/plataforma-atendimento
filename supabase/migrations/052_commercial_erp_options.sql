-- Catálogo de ERPs por workspace (CRM comercial)

CREATE TABLE IF NOT EXISTS public.commercial_erp_options (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_erp_options_workspace_name
  ON public.commercial_erp_options (workspace_id, lower(name));

CREATE INDEX IF NOT EXISTS idx_commercial_erp_options_workspace_sort
  ON public.commercial_erp_options (workspace_id, sort_order);

-- Migrar erp_atual (custom field legado) para coluna nativa erp
UPDATE public.commercial_leads
SET erp = trim(custom_fields->>'erp_atual')
WHERE (erp IS NULL OR trim(erp) = '')
  AND custom_fields ? 'erp_atual'
  AND trim(coalesce(custom_fields->>'erp_atual', '')) <> '';

ALTER TABLE public.commercial_erp_options ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS service_role_all ON public.commercial_erp_options;
CREATE POLICY service_role_all ON public.commercial_erp_options
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.commercial_erp_options DISABLE ROW LEVEL SECURITY;

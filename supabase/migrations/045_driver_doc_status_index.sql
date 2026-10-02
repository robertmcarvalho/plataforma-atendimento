-- Índice para filtro doc_status em entregadores ativos
CREATE INDEX IF NOT EXISTS idx_drivers_workspace_doc_status_active
  ON public.drivers (workspace_id, doc_status)
  WHERE status = 'active';

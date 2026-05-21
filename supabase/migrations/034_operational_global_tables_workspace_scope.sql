-- Tenantiza tabelas operacionais que ainda apareciam como globais na auditoria.
-- Safe rollout: colunas com backfill, índices IF NOT EXISTS e triggers idempotentes.

ALTER TABLE public.pending_tasks
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.supply_requests
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.financial_imports
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.financial_import_rows
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

ALTER TABLE public.processed_webhook_events
  ADD COLUMN IF NOT EXISTS workspace_id uuid REFERENCES public.workspaces(id) ON DELETE CASCADE;

UPDATE public.pending_tasks t
SET workspace_id = COALESCE(
  t.workspace_id,
  (SELECT c.workspace_id FROM public.conversations c WHERE c.id = t.conversation_id),
  (SELECT c.workspace_id FROM public.contacts c WHERE c.id = t.contact_id),
  (SELECT d.workspace_id FROM public.drivers d WHERE d.id = t.driver_id),
  (SELECT s.workspace_id FROM public.sectors s WHERE s.id = t.sector_id),
  (SELECT wm.workspace_id FROM public.workspace_memberships wm WHERE wm.user_id = t.assignee_id AND wm.is_active = true ORDER BY wm.is_default DESC, wm.created_at LIMIT 1),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE t.workspace_id IS NULL;

UPDATE public.supply_requests r
SET workspace_id = COALESCE(
  r.workspace_id,
  (SELECT l.workspace_id FROM public.leaders l WHERE l.id = r.leader_id),
  (SELECT d.workspace_id FROM public.drivers d WHERE d.id = r.driver_id),
  (SELECT p.workspace_id FROM public.pharmacies p WHERE p.id = r.pharmacy_id),
  (SELECT e.workspace_id FROM public.financial_entries e WHERE e.id = r.financial_entry_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE r.workspace_id IS NULL;

UPDATE public.financial_imports i
SET workspace_id = COALESCE(
  i.workspace_id,
  (SELECT wm.workspace_id FROM public.workspace_memberships wm WHERE wm.user_id = i.imported_by AND wm.is_active = true ORDER BY wm.is_default DESC, wm.created_at LIMIT 1),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE i.workspace_id IS NULL;

UPDATE public.financial_import_rows r
SET workspace_id = COALESCE(
  r.workspace_id,
  (SELECT i.workspace_id FROM public.financial_imports i WHERE i.id = r.import_id),
  (SELECT d.workspace_id FROM public.drivers d WHERE d.id = r.driver_id),
  (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1)
)
WHERE r.workspace_id IS NULL;

UPDATE public.processed_webhook_events e
SET workspace_id = COALESCE(e.workspace_id, (SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1))
WHERE e.workspace_id IS NULL;

ALTER TABLE public.pending_tasks ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.supply_requests ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.financial_imports ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.financial_import_rows ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE public.processed_webhook_events ALTER COLUMN workspace_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_pending_tasks_workspace_status_due
  ON public.pending_tasks(workspace_id, status, due_at);

CREATE INDEX IF NOT EXISTS idx_pending_tasks_workspace_assignee_status
  ON public.pending_tasks(workspace_id, assignee_id, status);

CREATE INDEX IF NOT EXISTS idx_pending_tasks_workspace_conversation
  ON public.pending_tasks(workspace_id, conversation_id);

CREATE INDEX IF NOT EXISTS idx_supply_requests_workspace_leader_created
  ON public.supply_requests(workspace_id, leader_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_imports_workspace_created
  ON public.financial_imports(workspace_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_financial_import_rows_workspace_import
  ON public.financial_import_rows(workspace_id, import_id);

CREATE INDEX IF NOT EXISTS idx_processed_webhook_events_workspace_processed
  ON public.processed_webhook_events(workspace_id, processed_at DESC);

CREATE OR REPLACE FUNCTION public.resolve_default_workspace_id()
RETURNS uuid AS $$
  SELECT id FROM public.workspaces ORDER BY created_at LIMIT 1;
$$ LANGUAGE sql STABLE;

CREATE OR REPLACE FUNCTION public.set_pending_tasks_workspace_id()
RETURNS trigger AS $$
BEGIN
  NEW.workspace_id := COALESCE(
    NEW.workspace_id,
    (SELECT c.workspace_id FROM public.conversations c WHERE c.id = NEW.conversation_id),
    (SELECT c.workspace_id FROM public.contacts c WHERE c.id = NEW.contact_id),
    (SELECT d.workspace_id FROM public.drivers d WHERE d.id = NEW.driver_id),
    (SELECT s.workspace_id FROM public.sectors s WHERE s.id = NEW.sector_id),
    (SELECT wm.workspace_id FROM public.workspace_memberships wm WHERE wm.user_id = NEW.assignee_id AND wm.is_active = true ORDER BY wm.is_default DESC, wm.created_at LIMIT 1),
    public.resolve_default_workspace_id()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_pending_tasks_workspace_id ON public.pending_tasks;
CREATE TRIGGER tr_pending_tasks_workspace_id
  BEFORE INSERT OR UPDATE ON public.pending_tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_pending_tasks_workspace_id();

CREATE OR REPLACE FUNCTION public.set_supply_requests_workspace_id()
RETURNS trigger AS $$
BEGIN
  NEW.workspace_id := COALESCE(
    NEW.workspace_id,
    (SELECT l.workspace_id FROM public.leaders l WHERE l.id = NEW.leader_id),
    (SELECT d.workspace_id FROM public.drivers d WHERE d.id = NEW.driver_id),
    (SELECT p.workspace_id FROM public.pharmacies p WHERE p.id = NEW.pharmacy_id),
    (SELECT e.workspace_id FROM public.financial_entries e WHERE e.id = NEW.financial_entry_id),
    public.resolve_default_workspace_id()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_supply_requests_workspace_id ON public.supply_requests;
CREATE TRIGGER tr_supply_requests_workspace_id
  BEFORE INSERT OR UPDATE ON public.supply_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_supply_requests_workspace_id();

CREATE OR REPLACE FUNCTION public.set_financial_import_rows_workspace_id()
RETURNS trigger AS $$
BEGIN
  NEW.workspace_id := COALESCE(
    NEW.workspace_id,
    (SELECT i.workspace_id FROM public.financial_imports i WHERE i.id = NEW.import_id),
    (SELECT d.workspace_id FROM public.drivers d WHERE d.id = NEW.driver_id),
    public.resolve_default_workspace_id()
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_financial_import_rows_workspace_id ON public.financial_import_rows;
CREATE TRIGGER tr_financial_import_rows_workspace_id
  BEFORE INSERT OR UPDATE ON public.financial_import_rows
  FOR EACH ROW EXECUTE FUNCTION public.set_financial_import_rows_workspace_id();

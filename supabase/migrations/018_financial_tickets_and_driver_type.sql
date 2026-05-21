-- Ticketing financeiro operacional + tipo de entregador (fixo/diarista)

ALTER TABLE public.drivers
ADD COLUMN IF NOT EXISTS driver_type text NOT NULL DEFAULT 'fixed'
CHECK (driver_type IN ('fixed', 'daily'));

CREATE TABLE IF NOT EXISTS public.tickets (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_code text UNIQUE NOT NULL,
  tenant_id uuid NULL,
  conversation_id uuid NULL REFERENCES public.conversations(id),
  persona text NOT NULL CHECK (persona IN ('driver', 'pharmacy', 'leader')),
  type text NOT NULL CHECK (type IN ('payment', 'contestation', 'app', 'question', 'advance')),
  priority text NOT NULL CHECK (priority IN ('high', 'medium', 'normal', 'bot')),
  sla_minutes int NOT NULL CHECK (sla_minutes IN (120, 240, 480, 1440)),
  channel_origin text NOT NULL CHECK (channel_origin IN ('whatsapp', 'app', 'portal')),
  driver_id uuid NULL REFERENCES public.drivers(id),
  leader_id uuid NULL REFERENCES public.leaders(id),
  pharmacy_id uuid NULL REFERENCES public.pharmacies(id),
  assignee_user_id uuid NULL REFERENCES public.users(id),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'resolved', 'overdue')),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz NULL,
  resolved_at timestamptz NULL,
  due_at timestamptz NOT NULL,
  context_snap jsonb NOT NULL,
  classifier_version text NOT NULL DEFAULT 'v1-keyword',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.ticket_events (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_id uuid NULL REFERENCES public.tickets(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  payload jsonb NULL,
  created_by uuid NULL REFERENCES public.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tickets_status_due_at ON public.tickets(status, due_at);
CREATE INDEX IF NOT EXISTS idx_tickets_driver_id ON public.tickets(driver_id);
CREATE INDEX IF NOT EXISTS idx_tickets_leader_id ON public.tickets(leader_id);
CREATE INDEX IF NOT EXISTS idx_tickets_assignee_user_id ON public.tickets(assignee_user_id);
CREATE INDEX IF NOT EXISTS idx_ticket_events_ticket_id ON public.ticket_events(ticket_id, created_at);

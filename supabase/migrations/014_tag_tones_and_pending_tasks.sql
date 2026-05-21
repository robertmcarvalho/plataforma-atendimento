-- Proposta 2: governança de tags + central de pendências.

ALTER TABLE public.conversation_tag_catalog
  ADD COLUMN IF NOT EXISTS tone text NOT NULL DEFAULT 'primary',
  ADD COLUMN IF NOT EXISTS is_system boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_user_editable boolean NOT NULL DEFAULT true;

UPDATE public.conversation_tag_catalog
SET tone = CASE slug
  WHEN 'risco_sla' THEN 'warning'
  WHEN 'aguardando_cliente' THEN 'info'
  WHEN 'aguardando_operacao' THEN 'primary'
  WHEN 'reincidente_7d' THEN 'danger'
  WHEN 'resolvido_primeiro_contato' THEN 'success'
  WHEN 'vip' THEN 'warning'
  ELSE tone
END;

INSERT INTO public.conversation_tag_catalog (slug, label_pt, sort_order, tone, is_system, is_user_editable)
VALUES
  ('cadastro-pendente', 'Cadastro pendente', 30, 'warning', true, false),
  ('sem-cadastro', 'Sem cadastro', 31, 'danger', true, false)
ON CONFLICT (slug) DO UPDATE
SET label_pt = EXCLUDED.label_pt,
    tone = EXCLUDED.tone,
    is_system = EXCLUDED.is_system;

CREATE TABLE IF NOT EXISTS public.pending_tasks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  task_type text NOT NULL, -- ex.: driver_registration_completion
  title text NOT NULL,
  description text,
  status text NOT NULL DEFAULT 'open', -- open | in_progress | done | cancelled
  priority text NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
  conversation_id uuid REFERENCES public.conversations(id) ON DELETE CASCADE,
  contact_id uuid REFERENCES public.contacts(id) ON DELETE SET NULL,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  assignee_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  sector_id uuid REFERENCES public.sectors(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'system', -- system | bot | manual
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pending_tasks_status_priority_due
  ON public.pending_tasks(status, priority, due_at);

CREATE INDEX IF NOT EXISTS idx_pending_tasks_assignee_status
  ON public.pending_tasks(assignee_id, status);

CREATE INDEX IF NOT EXISTS idx_pending_tasks_sector_status
  ON public.pending_tasks(sector_id, status);

CREATE INDEX IF NOT EXISTS idx_pending_tasks_conversation_id
  ON public.pending_tasks(conversation_id);

-- ==========================================================
-- MIGRATION 001 — Estrutura completa do banco de dados
-- Plataforma de Suporte e Atendimento via WhatsApp
-- ==========================================================

-- Habilitar extensão UUID
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ==========================================================
-- GRUPO: Identidade e Acesso
-- ==========================================================

CREATE TABLE roles (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL UNIQUE,
  -- admin | supervisor | attendant | operational | financial
  permissions jsonb NOT NULL DEFAULT '{}',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sectors (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name           text NOT NULL,
  description    text,
  is_active      boolean NOT NULL DEFAULT true,
  -- ex: {"seg":{"start":"08:00","end":"18:00"},"sab":{"start":"08:00","end":"12:00"}}
  business_hours jsonb NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       text NOT NULL,
  email      text NOT NULL UNIQUE,
  phone      text,
  role_id    uuid REFERENCES roles(id) ON DELETE SET NULL,
  sector_id  uuid REFERENCES sectors(id) ON DELETE SET NULL,
  is_active  boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- GRUPO: Cadastros Operacionais
-- ==========================================================

CREATE TABLE leaders (
  id         uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       text NOT NULL,
  phone      text NOT NULL UNIQUE,
  email      text,
  city       text,
  state      text,
  status     text NOT NULL DEFAULT 'active', -- active | inactive
  notes      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pharmacies (
  id                       uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  legal_name               text NOT NULL,
  trade_name               text NOT NULL,
  cnpj                     text UNIQUE,
  city                     text,
  state                    text,
  phone                    text,
  email                    text,
  status                   text NOT NULL DEFAULT 'active', -- active | inactive
  primary_attendant_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  secondary_attendant_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  leader_id                uuid REFERENCES leaders(id) ON DELETE SET NULL,
  notes                    text,
  tags                     text[] DEFAULT '{}',
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drivers (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  text NOT NULL,
  cpf                   text UNIQUE,
  phone                 text NOT NULL UNIQUE,
  city                  text,
  status                text NOT NULL DEFAULT 'active', -- active | inactive | blocked
  primary_pharmacy_id   uuid REFERENCES pharmacies(id) ON DELETE SET NULL,
  inherit_from_primary  boolean NOT NULL DEFAULT true,
  override_attendant_id uuid REFERENCES users(id) ON DELETE SET NULL,
  override_leader_id    uuid REFERENCES leaders(id) ON DELETE SET NULL,
  doc_status            text NOT NULL DEFAULT 'ok', -- ok | pending | expired
  notes                 text,
  tags                  text[] DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Vínculo N:N entregador <> farmácia
CREATE TABLE driver_pharmacy_links (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id    uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  pharmacy_id  uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  is_primary   boolean NOT NULL DEFAULT false,
  is_active    boolean NOT NULL DEFAULT true,
  started_at   date,
  ended_at     date,
  notes        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE(driver_id, pharmacy_id)
);

-- Regra: apenas um vínculo pode ser primário por entregador
CREATE UNIQUE INDEX idx_driver_pharmacy_links_one_primary
  ON driver_pharmacy_links(driver_id)
  WHERE is_primary = true AND is_active = true;

-- Vínculo N:N líder <> farmácia
CREATE TABLE leader_pharmacy_links (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  leader_id   uuid NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  pharmacy_id uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(leader_id, pharmacy_id)
);

-- ==========================================================
-- GRUPO: Contatos e Conversas
-- ==========================================================

CREATE TABLE contacts (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  wa_phone      text NOT NULL UNIQUE,    -- número normalizado E.164
  display_name  text,
  profile_type  text NOT NULL DEFAULT 'unknown', -- driver | pharmacy | leader | unknown
  driver_id     uuid REFERENCES drivers(id) ON DELETE SET NULL,
  pharmacy_id   uuid REFERENCES pharmacies(id) ON DELETE SET NULL,
  leader_id     uuid REFERENCES leaders(id) ON DELETE SET NULL,
  is_blocked    boolean NOT NULL DEFAULT false,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversations (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id            uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  sector_id             uuid REFERENCES sectors(id) ON DELETE SET NULL,
  attendant_id          uuid REFERENCES users(id) ON DELETE SET NULL,
  -- contexto operacional
  context_pharmacy_id   uuid REFERENCES pharmacies(id) ON DELETE SET NULL,
  context_driver_id     uuid REFERENCES drivers(id) ON DELETE SET NULL,
  context_leader_id     uuid REFERENCES leaders(id) ON DELETE SET NULL,
  -- status e controle
  status                text NOT NULL DEFAULT 'open', -- open | pending | resolved | closed
  priority              text NOT NULL DEFAULT 'normal', -- low | normal | high | urgent
  -- SLA
  sla_policy_id                uuid,
  sla_first_response_deadline  timestamptz,
  sla_first_response_at        timestamptz,
  sla_first_response_ok        boolean,
  sla_resolution_deadline      timestamptz,
  sla_resolved_ok              boolean,
  -- metadados
  opened_at             timestamptz NOT NULL DEFAULT now(),
  last_message_at       timestamptz,
  resolved_at           timestamptz,
  close_reason          text,
  tags                  text[] DEFAULT '{}',
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  meta_message_id  text UNIQUE,            -- ID da Meta (chave de idempotência)
  direction        text NOT NULL,          -- inbound | outbound
  type             text NOT NULL DEFAULT 'text', -- text | image | audio | document | template
  content          text,
  media_url        text,
  template_id      uuid,
  status           text NOT NULL DEFAULT 'sent', -- sent | delivered | read | failed
  sent_at          timestamptz,
  delivered_at     timestamptz,
  read_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE internal_notes (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  author_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE internal_chat_messages (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id  uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content          text NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_assignments (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  from_attendant_id uuid REFERENCES users(id) ON DELETE SET NULL,
  to_attendant_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  from_sector_id    uuid REFERENCES sectors(id) ON DELETE SET NULL,
  to_sector_id      uuid REFERENCES sectors(id) ON DELETE SET NULL,
  reason            text,
  assigned_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- GRUPO: Idempotência de Webhooks
-- ==========================================================

CREATE TABLE processed_webhook_events (
  meta_message_id  text PRIMARY KEY,
  event_type       text,
  processed_at     timestamptz NOT NULL DEFAULT now()
);

-- Index para limpeza do TTL (deletar registros com > 7 dias)
CREATE INDEX idx_processed_webhook_events_processed_at
  ON processed_webhook_events(processed_at);

-- ==========================================================
-- GRUPO: Bot e Sessão
-- ==========================================================

CREATE TABLE bot_sessions (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  contact_id       uuid NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  conversation_id  uuid REFERENCES conversations(id) ON DELETE CASCADE,
  current_step     text NOT NULL DEFAULT 'identify',
  context_data     jsonb NOT NULL DEFAULT '{}',
  expires_at       timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE routing_rules (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        text NOT NULL,
  priority    int NOT NULL DEFAULT 0,
  conditions  jsonb NOT NULL DEFAULT '{}',
  action      jsonb NOT NULL DEFAULT '{}',
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE bot_flows (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              text NOT NULL,
  trigger_keywords  text[] DEFAULT '{}',
  steps             jsonb NOT NULL DEFAULT '[]',
  is_active         boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- GRUPO: SLA
-- ==========================================================

CREATE TABLE sla_policies (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                    text NOT NULL,
  sector_id               uuid REFERENCES sectors(id) ON DELETE SET NULL,
  priority                text, -- low | normal | high | urgent (null = todos)
  profile_type            text, -- driver | pharmacy | leader (null = todos)
  first_response_minutes  int NOT NULL DEFAULT 30,
  treatment_minutes       int NOT NULL DEFAULT 120,
  resolution_minutes      int NOT NULL DEFAULT 480,
  use_business_hours      boolean NOT NULL DEFAULT true,
  created_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sla_events (
  id                      uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  conversation_id         uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  event_type              text NOT NULL, -- breach_first_response | breach_treatment | breach_resolution
  severity                text NOT NULL, -- warning | critical
  notified_attendant      boolean NOT NULL DEFAULT false,
  notified_supervisor     boolean NOT NULL DEFAULT false,
  created_at              timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- GRUPO: Templates de Mensagem
-- ==========================================================

CREATE TABLE message_templates (
  id                    uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  text NOT NULL,
  category              text NOT NULL, -- discount | document | welcome | closing | operational | leader | pharmacy
  body                  text NOT NULL,
  variables             text[] DEFAULT '{}',
  meta_template_name    text,
  meta_template_status  text NOT NULL DEFAULT 'draft', -- draft | pending | approved | rejected | paused
  meta_template_language text NOT NULL DEFAULT 'pt_BR',
  is_active             boolean NOT NULL DEFAULT true,
  created_by            uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- GRUPO: Campanhas e Disparos em Massa
-- ==========================================================

CREATE TABLE campaigns (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name              text NOT NULL,
  type              text NOT NULL DEFAULT 'manual', -- manual | scheduled | automated
  status            text NOT NULL DEFAULT 'draft',  -- draft | scheduled | running | paused | completed | failed
  template_id       uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  audience_type     text, -- drivers | leaders | pharmacies | custom
  audience_filters  jsonb NOT NULL DEFAULT '{}',
  scheduled_at      timestamptz,
  started_at        timestamptz,
  completed_at      timestamptz,
  -- contadores
  total_recipients  int NOT NULL DEFAULT 0,
  sent_count        int NOT NULL DEFAULT 0,
  delivered_count   int NOT NULL DEFAULT 0,
  read_count        int NOT NULL DEFAULT 0,
  failed_count      int NOT NULL DEFAULT 0,
  -- configuração anti-ban
  dispatch_config   jsonb NOT NULL DEFAULT '{
    "batch_size": 10,
    "pause_between_messages_ms": 1500,
    "pause_between_batches_ms": 60000,
    "max_per_hour": 200,
    "jitter_ms": 500,
    "retry_on_failure": true,
    "max_retries": 3,
    "retry_backoff_ms": 30000
  }',
  created_by        uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_recipients (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id      uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  contact_id       uuid REFERENCES contacts(id) ON DELETE SET NULL,
  wa_phone         text NOT NULL,
  variables        jsonb NOT NULL DEFAULT '{}',
  status           text NOT NULL DEFAULT 'pending', -- pending | sent | delivered | read | failed | skipped
  meta_message_id  text,
  sent_at          timestamptz,
  delivered_at     timestamptz,
  read_at          timestamptz,
  error_message    text,
  retry_count      int NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE campaign_dispatch_logs (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  campaign_id     uuid NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
  recipient_id    uuid REFERENCES campaign_recipients(id) ON DELETE SET NULL,
  action          text NOT NULL, -- sent | paused | retried | failed | skipped | rate_limited
  detail          text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- GRUPO: Automações
-- ==========================================================

CREATE TABLE automation_rules (
  id                 uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name               text NOT NULL,
  trigger_type       text NOT NULL, -- schedule | event
  cron_expression    text,
  event_type         text,
  audience_type      text,
  audience_filters   jsonb NOT NULL DEFAULT '{}',
  template_id        uuid REFERENCES message_templates(id) ON DELETE SET NULL,
  variables_mapping  jsonb NOT NULL DEFAULT '{}',
  dispatch_config    jsonb NOT NULL DEFAULT '{
    "batch_size": 10,
    "pause_between_messages_ms": 1500,
    "pause_between_batches_ms": 60000,
    "max_per_hour": 200,
    "jitter_ms": 500
  }',
  is_active          boolean NOT NULL DEFAULT false,
  require_approval   boolean NOT NULL DEFAULT false,
  notes              text,
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE automation_runs (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  rule_id          uuid NOT NULL REFERENCES automation_rules(id) ON DELETE CASCADE,
  campaign_id      uuid REFERENCES campaigns(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'running', -- running | completed | failed
  total_recipients int NOT NULL DEFAULT 0,
  sent_count       int NOT NULL DEFAULT 0,
  failed_count     int NOT NULL DEFAULT 0,
  started_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);

-- ==========================================================
-- GRUPO: Financeiro do Entregador
-- ==========================================================

CREATE TABLE financial_entries (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  driver_id           uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  pharmacy_id         uuid REFERENCES pharmacies(id) ON DELETE SET NULL,
  type                text NOT NULL, -- uniform | bag | quota | digital_cert | fine | adjustment | other
  description         text,
  total_amount        numeric(10,2) NOT NULL,
  installments_count  int NOT NULL DEFAULT 1,
  installment_amount  numeric(10,2) NOT NULL,
  frequency           text NOT NULL DEFAULT 'weekly', -- weekly | monthly
  start_date          date NOT NULL,
  status              text NOT NULL DEFAULT 'draft', -- draft | pending_approval | approved | active | settled | cancelled
  approved_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at         timestamptz,
  rejection_reason    text,
  notes               text,
  created_by          uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE financial_installments (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  entry_id            uuid NOT NULL REFERENCES financial_entries(id) ON DELETE CASCADE,
  installment_number  int NOT NULL,
  amount              numeric(10,2) NOT NULL,
  due_date            date NOT NULL,
  status              text NOT NULL DEFAULT 'pending', -- pending | paid | overdue | cancelled
  reference           text,
  paid_at             timestamptz,
  paid_by             uuid REFERENCES users(id) ON DELETE SET NULL,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entry_id, installment_number)
);

CREATE TABLE financial_exports (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  filters       jsonb NOT NULL DEFAULT '{}',
  file_url      text,
  generated_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- GRUPO: Auditoria
-- ==========================================================

CREATE TABLE audit_logs (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  entity_type  text NOT NULL,
  entity_id    uuid,
  action       text NOT NULL,
  old_data     jsonb,
  new_data     jsonb,
  ip_address   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ==========================================================
-- ÍNDICES DE PERFORMANCE
-- ==========================================================

-- Conversas
CREATE INDEX idx_conversations_contact_id ON conversations(contact_id);
CREATE INDEX idx_conversations_status ON conversations(status);
CREATE INDEX idx_conversations_attendant_id ON conversations(attendant_id);
CREATE INDEX idx_conversations_sector_id ON conversations(sector_id);
CREATE INDEX idx_conversations_context_pharmacy_id ON conversations(context_pharmacy_id);
CREATE INDEX idx_conversations_last_message_at ON conversations(last_message_at DESC);

-- Mensagens
CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_meta_message_id ON messages(meta_message_id);

-- Contatos
CREATE INDEX idx_contacts_wa_phone ON contacts(wa_phone);
CREATE INDEX idx_contacts_driver_id ON contacts(driver_id);
CREATE INDEX idx_contacts_pharmacy_id ON contacts(pharmacy_id);

-- Entregadores
CREATE INDEX idx_drivers_phone ON drivers(phone);
CREATE INDEX idx_drivers_cpf ON drivers(cpf);
CREATE INDEX idx_drivers_primary_pharmacy_id ON drivers(primary_pharmacy_id);

-- Vínculos
CREATE INDEX idx_driver_pharmacy_links_driver_id ON driver_pharmacy_links(driver_id);
CREATE INDEX idx_driver_pharmacy_links_pharmacy_id ON driver_pharmacy_links(pharmacy_id);

-- Parcelas
CREATE INDEX idx_financial_installments_entry_id ON financial_installments(entry_id);
CREATE INDEX idx_financial_installments_due_date ON financial_installments(due_date);
CREATE INDEX idx_financial_installments_status ON financial_installments(status);

-- Campanhas
CREATE INDEX idx_campaign_recipients_campaign_id ON campaign_recipients(campaign_id);
CREATE INDEX idx_campaign_recipients_status ON campaign_recipients(status);

-- Auditoria
CREATE INDEX idx_audit_logs_entity ON audit_logs(entity_type, entity_id);
CREATE INDEX idx_audit_logs_user_id ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- ==========================================================
-- DADOS INICIAIS (SEED)
-- ==========================================================

INSERT INTO roles (id, name, permissions) VALUES
  (uuid_generate_v4(), 'admin', '{"all": true}'),
  (uuid_generate_v4(), 'supervisor', '{
    "conversations": {"view": true, "assign": true, "transfer": true, "close": true},
    "reports": {"view": true},
    "sla": {"view": true, "manage": true},
    "campaigns": {"view": true, "create": true},
    "automations": {"view": true}
  }'),
  (uuid_generate_v4(), 'attendant', '{
    "conversations": {"view": true, "reply": true, "transfer": true, "close": true},
    "templates": {"view": true, "use": true},
    "notes": {"create": true}
  }'),
  (uuid_generate_v4(), 'operational', '{
    "pharmacies": {"view": true, "manage": true},
    "drivers": {"view": true, "manage": true},
    "leaders": {"view": true, "manage": true},
    "financial": {"view": true}
  }'),
  (uuid_generate_v4(), 'financial', '{
    "financial": {"view": true, "manage": true, "approve": true, "export": true},
    "drivers": {"view": true}
  }');

INSERT INTO sectors (name, description, business_hours) VALUES
  ('Atendimento Geral', 'Fila principal de atendimento', '{"seg":{"start":"08:00","end":"18:00"},"ter":{"start":"08:00","end":"18:00"},"qua":{"start":"08:00","end":"18:00"},"qui":{"start":"08:00","end":"18:00"},"sex":{"start":"08:00","end":"18:00"}}'),
  ('Financeiro', 'Atendimentos relacionados a finanças e descontos', '{"seg":{"start":"08:00","end":"17:00"},"ter":{"start":"08:00","end":"17:00"},"qua":{"start":"08:00","end":"17:00"},"qui":{"start":"08:00","end":"17:00"},"sex":{"start":"08:00","end":"17:00"}}'),
  ('Operacional', 'Cadastros, vínculos e suporte operacional', '{"seg":{"start":"08:00","end":"18:00"},"ter":{"start":"08:00","end":"18:00"},"qua":{"start":"08:00","end":"18:00"},"qui":{"start":"08:00","end":"18:00"},"sex":{"start":"08:00","end":"18:00"}}'),
  ('Suporte Técnico', 'Problemas técnicos e de acesso', '{"seg":{"start":"08:00","end":"17:00"},"ter":{"start":"08:00","end":"17:00"},"qua":{"start":"08:00","end":"17:00"},"qui":{"start":"08:00","end":"17:00"},"sex":{"start":"08:00","end":"17:00"}}');

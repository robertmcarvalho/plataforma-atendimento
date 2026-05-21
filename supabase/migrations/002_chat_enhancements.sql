-- ==========================================================
-- MIGRATION 002 — Melhorias de Chat e Configurações
-- ==========================================================

-- Adicionar indicador de mensagens não lidas às conversas
ALTER TABLE conversations ADD COLUMN has_unread boolean NOT NULL DEFAULT false;

-- Criar tabela de configurações globais da aplicação
CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Inserir configuração inicial para assinatura de mensagens
INSERT INTO app_settings (key, value) VALUES ('chat_signature_enabled', 'true'::jsonb);

-- Adicionar índice para performance na busca de conversas não lidas
CREATE INDEX idx_conversations_has_unread ON conversations(has_unread) WHERE has_unread = true;

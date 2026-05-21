-- ==========================================================
-- MIGRATION 005 — Portal do Líder e Importação Financeira
-- ==========================================================

-- 1. Inserir a Role de Líder caso não exista
INSERT INTO roles (name, permissions)
SELECT 'leader', '{
  "leader_panel": {"view": true, "manage": true}
}'
WHERE NOT EXISTS (
  SELECT 1 FROM roles WHERE name = 'leader'
);

-- 2. Vincular a tabela de Líderes à tabela de Usuários (Login)
ALTER TABLE leaders
ADD COLUMN user_id uuid REFERENCES users(id) ON DELETE SET NULL;

-- Criar índice para performance na busca do líder logado
CREATE INDEX idx_leaders_user_id ON leaders(user_id);

-- 3. Criar a tabela de histórico de importações do ERP (Financeiro)
CREATE TABLE financial_imports (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  file_name        text NOT NULL,
  status           text NOT NULL DEFAULT 'pending', -- pending | processing | completed | failed
  total_rows       int NOT NULL DEFAULT 0,
  processed_rows   int NOT NULL DEFAULT 0,
  error_message    text,
  imported_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  started_at       timestamptz,
  completed_at     timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 4. Criar tabela de linhas importadas (para auditoria e controle linha a linha)
CREATE TABLE financial_import_rows (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  import_id        uuid NOT NULL REFERENCES financial_imports(id) ON DELETE CASCADE,
  driver_id        uuid REFERENCES drivers(id) ON DELETE SET NULL,
  driver_name      text,
  driver_cpf       text,
  gross_amount     numeric(10,2) NOT NULL, -- Valor Bruto do faturamento
  status           text NOT NULL DEFAULT 'pending', -- pending | success | failed
  error_message    text,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_financial_import_rows_import_id ON financial_import_rows(import_id);

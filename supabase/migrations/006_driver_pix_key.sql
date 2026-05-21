-- Adicionar chave PIX ao cadastro de entregadores
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS pix_key text;

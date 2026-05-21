-- Catálogo fixo de tags de conversa (slugs usados em conversations.tags)

CREATE TABLE conversation_tag_catalog (
  slug       text PRIMARY KEY,
  label_pt   text NOT NULL,
  sort_order int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO conversation_tag_catalog (slug, label_pt, sort_order) VALUES
  ('pagamento', 'Pagamento', 1),
  ('cadastro', 'Cadastro', 2),
  ('suporte_app', 'Suporte ao app', 3),
  ('falta', 'Falta', 4),
  ('documento', 'Documento', 5),
  ('roteirizacao', 'Roteirização', 6),
  ('vip', 'VIP', 7),
  ('risco_sla', 'Risco de SLA', 8),
  ('aguardando_cliente', 'Aguardando cliente', 9),
  ('aguardando_operacao', 'Aguardando operação', 10),
  ('reincidente_7d', 'Reincidente (7 dias)', 11),
  ('resolvido_primeiro_contato', 'Resolvido no primeiro contato', 12)
ON CONFLICT (slug) DO NOTHING;

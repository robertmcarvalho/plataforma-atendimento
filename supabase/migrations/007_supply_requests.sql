-- Tabela de solicitações de insumos (uniformes e bags)
CREATE TABLE supply_requests (
  id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  leader_id         uuid NOT NULL REFERENCES leaders(id) ON DELETE CASCADE,
  driver_id         uuid NOT NULL REFERENCES drivers(id) ON DELETE CASCADE,
  pharmacy_id       uuid NOT NULL REFERENCES pharmacies(id) ON DELETE CASCADE,
  item_type         text NOT NULL, -- uniform | bag
  size              text,          -- P, M, G, GG, etc. (opcional para bag)
  status            text NOT NULL DEFAULT 'pending', -- pending | dispatched | delivered | canceled
  tracking_link     text,
  expected_delivery date,
  delivered_at      timestamptz,
  financial_entry_id uuid REFERENCES financial_entries(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- Trigger para atualizar updated_at
CREATE TRIGGER tr_supply_requests_updated_at
  BEFORE UPDATE ON supply_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

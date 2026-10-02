-- Ensure bank movement dedupe unique index exists (idempotent).
-- Logical uniqueness is (bank_account_id, external_id) when external_id is present.
-- C6/Cora/CSV parsers now use content+occurrence fingerprints (not file line indexes).

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_bank_movements_dedupe
  ON public.billing_bank_movements (bank_account_id, external_id)
  WHERE external_id IS NOT NULL;

COMMENT ON INDEX public.idx_billing_bank_movements_dedupe IS
  'Dedupa importações de extrato por (conta, external_id). Fingerprint C6/CSV/Cora = conteúdo+ocorrência.';

-- Cora extrato/saldo sync (MVP Flux): conta destino + cursor/saldo da última sync.
-- Feature flags runtime: BILLING_CORA_STATEMENT_SYNC_ENABLED / BILLING_CORA_STATEMENT_SYNC_WRITE (default false).
-- Coop: fora do escopo (hook futuro via entity_type).

ALTER TABLE public.billing_bank_movements
  DROP CONSTRAINT IF EXISTS billing_bank_movements_source_check;

ALTER TABLE public.billing_bank_movements
  ADD CONSTRAINT billing_bank_movements_source_check
  CHECK (source IN ('csv', 'ofx', 'manual', 'cora', 'c6', 'cora_api'));

ALTER TABLE public.billing_cora_configs
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.billing_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS statement_sync_last_end_date date,
  ADD COLUMN IF NOT EXISTS statement_sync_last_success_at timestamptz,
  ADD COLUMN IF NOT EXISTS statement_sync_last_status text,
  ADD COLUMN IF NOT EXISTS statement_sync_last_error text,
  ADD COLUMN IF NOT EXISTS statement_sync_last_balance_cents bigint,
  ADD COLUMN IF NOT EXISTS statement_sync_last_imported integer,
  ADD COLUMN IF NOT EXISTS statement_sync_last_skipped integer,
  ADD COLUMN IF NOT EXISTS statement_sync_last_window_start date,
  ADD COLUMN IF NOT EXISTS statement_sync_last_window_end date;

CREATE INDEX IF NOT EXISTS idx_billing_cora_configs_bank_account
  ON public.billing_cora_configs (bank_account_id)
  WHERE bank_account_id IS NOT NULL;

COMMENT ON COLUMN public.billing_cora_configs.bank_account_id IS
  'Conta billing_bank_accounts destino do import de extrato Cora (API). MVP: Flux.';
COMMENT ON COLUMN public.billing_cora_configs.statement_sync_last_end_date IS
  'Cursor civil (America/Sao_Paulo): end da última sync bem-sucedida; só avança no sucesso total.';
COMMENT ON COLUMN public.billing_cora_configs.statement_sync_last_balance_cents IS
  'Último saldo GET /third-party/account/balance (centavos), snapshot no sucesso ou dry-run persistido.';
COMMENT ON COLUMN public.billing_cora_configs.statement_sync_last_status IS
  'ok | failed | dry_run | skipped';

DROP VIEW IF EXISTS public.billing_cora_configs_public;

CREATE VIEW public.billing_cora_configs_public AS
SELECT
  id,
  workspace_id,
  entity_type,
  environment,
  enabled,
  mtls_secret_ref,
  bank_account_id,
  (client_id IS NOT NULL AND length(trim(client_id)) > 0) AS has_client_id,
  CASE
    WHEN client_id IS NULL OR length(trim(client_id)) = 0 THEN NULL
    WHEN length(trim(client_id)) <= 8 THEN repeat('*', length(trim(client_id)))
    ELSE left(trim(client_id), 4) || repeat('*', greatest(length(trim(client_id)) - 8, 0)) || right(trim(client_id), 4)
  END AS client_id_masked,
  fine_mode,
  fine_rate,
  fine_amount_cents,
  interest_rate,
  pix_qr_enabled,
  service_name_template,
  service_description_template,
  statement_sync_last_end_date,
  statement_sync_last_success_at,
  statement_sync_last_status,
  statement_sync_last_error,
  statement_sync_last_balance_cents,
  statement_sync_last_imported,
  statement_sync_last_skipped,
  statement_sync_last_window_start,
  statement_sync_last_window_end,
  created_at,
  updated_at
FROM public.billing_cora_configs;

COMMENT ON VIEW public.billing_cora_configs_public IS
  'Metadados Cora sem client_id em claro — inclui status da última sync de extrato.';

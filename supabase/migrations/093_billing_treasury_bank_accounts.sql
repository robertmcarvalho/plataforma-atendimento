-- Fase 8 — Tesouraria avançada: multi-conta, movimentos bancários, conciliação

ALTER TYPE public.billing_payment_method ADD VALUE IF NOT EXISTS 'credit_card';

CREATE TABLE IF NOT EXISTS public.billing_bank_accounts (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  legal_entity_id     uuid NOT NULL REFERENCES public.billing_legal_entities(id) ON DELETE CASCADE,
  name                text NOT NULL,
  bank_code           text,
  bank_name           text,
  branch_number       text,
  account_number      text,
  account_digit       text,
  account_type        public.billing_bank_account_type,
  pix_key             text,
  pix_key_type        text,
  is_default          boolean NOT NULL DEFAULT false,
  active              boolean NOT NULL DEFAULT true,
  pix_export_template text NOT NULL DEFAULT 'generic'
    CHECK (pix_export_template IN ('generic', 'itau', 'bradesco', 'santander', 'bb', 'inter', 'nubank')),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_bank_accounts_workspace_name_unique UNIQUE (workspace_id, legal_entity_id, name)
);

CREATE INDEX IF NOT EXISTS idx_billing_bank_accounts_entity
  ON public.billing_bank_accounts (workspace_id, legal_entity_id, active);

CREATE TABLE IF NOT EXISTS public.billing_bank_movements (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id        uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  bank_account_id     uuid NOT NULL REFERENCES public.billing_bank_accounts(id) ON DELETE CASCADE,
  movement_date       date NOT NULL,
  amount_cents        integer NOT NULL CHECK (amount_cents > 0),
  direction           text NOT NULL CHECK (direction IN ('credit', 'debit')),
  description         text,
  external_id         text,
  source              text NOT NULL DEFAULT 'csv' CHECK (source IN ('csv', 'ofx', 'manual')),
  import_batch_id     uuid,
  reconciled          boolean NOT NULL DEFAULT false,
  billing_payment_id  uuid REFERENCES public.billing_payments(id) ON DELETE SET NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_bank_movements_dedupe
  ON public.billing_bank_movements (bank_account_id, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_bank_movements_account_date
  ON public.billing_bank_movements (workspace_id, bank_account_id, movement_date DESC);

CREATE INDEX IF NOT EXISTS idx_billing_bank_movements_unreconciled
  ON public.billing_bank_movements (workspace_id, bank_account_id, reconciled)
  WHERE reconciled = false;

ALTER TABLE public.billing_payments
  ADD COLUMN IF NOT EXISTS bank_account_id uuid REFERENCES public.billing_bank_accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS reconciled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS card_last_four text,
  ADD COLUMN IF NOT EXISTS card_brand text;

CREATE INDEX IF NOT EXISTS idx_billing_payments_bank_account
  ON public.billing_payments (bank_account_id)
  WHERE bank_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_billing_payments_unreconciled
  ON public.billing_payments (workspace_id, reconciled)
  WHERE reconciled = false;

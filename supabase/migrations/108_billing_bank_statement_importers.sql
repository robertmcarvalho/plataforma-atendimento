-- Billing treasury: identify Cora/C6 bank statement imports.

ALTER TABLE public.billing_bank_movements
  DROP CONSTRAINT IF EXISTS billing_bank_movements_source_check;

ALTER TABLE public.billing_bank_movements
  ADD CONSTRAINT billing_bank_movements_source_check
  CHECK (source IN ('csv', 'ofx', 'manual', 'cora', 'c6'));

-- C6 Bank PIX batch export template

ALTER TABLE public.billing_bank_accounts
  DROP CONSTRAINT IF EXISTS billing_bank_accounts_pix_export_template_check;

ALTER TABLE public.billing_bank_accounts
  ADD CONSTRAINT billing_bank_accounts_pix_export_template_check
  CHECK (pix_export_template IN ('generic', 'itau', 'bradesco', 'santander', 'bb', 'inter', 'nubank', 'c6'));

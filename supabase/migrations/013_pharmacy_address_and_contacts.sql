-- Endereço e contatos da farmácia (alinhado a pharmacySchema / UI / import Excel)
ALTER TABLE public.pharmacies
  ADD COLUMN IF NOT EXISTS address_cep text,
  ADD COLUMN IF NOT EXISTS address_street text,
  ADD COLUMN IF NOT EXISTS address_number text,
  ADD COLUMN IF NOT EXISTS address_neighborhood text,
  ADD COLUMN IF NOT EXISTS address_complement text,
  ADD COLUMN IF NOT EXISTS contact_expedition_name text,
  ADD COLUMN IF NOT EXISTS contact_expedition_phone text,
  ADD COLUMN IF NOT EXISTS contact_expedition_email text,
  ADD COLUMN IF NOT EXISTS contact_financial_name text,
  ADD COLUMN IF NOT EXISTS contact_financial_phone text,
  ADD COLUMN IF NOT EXISTS contact_financial_email text,
  ADD COLUMN IF NOT EXISTS contact_manager_name text,
  ADD COLUMN IF NOT EXISTS contact_manager_phone text,
  ADD COLUMN IF NOT EXISTS contact_manager_email text;

COMMENT ON COLUMN public.pharmacies.address_cep IS 'CEP (normalizado na API/UI)';
COMMENT ON COLUMN public.pharmacies.contact_expedition_name IS 'Contato expedição';

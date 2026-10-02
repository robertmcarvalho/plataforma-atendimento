-- Espelho do PDF do boleto Cora no storage Aethera (bucket billing-bank-slips).
-- pdf_url Cora permanece como origem; pdf_storage_path é o path canônico interno.

ALTER TABLE public.billing_bank_slips
  ADD COLUMN IF NOT EXISTS pdf_storage_path text;

COMMENT ON COLUMN public.billing_bank_slips.pdf_storage_path IS
  'Path no bucket billing-bank-slips ({workspaceId}/{bankSlipId}/boleto.pdf). Bytes espelhados da pdf_url Cora.';

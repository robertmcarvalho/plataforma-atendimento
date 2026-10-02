-- NFS-e Sprint 4 — paths de storage (DPS / NFS-e XML / DANFSe PDF).
-- Aplicar SOMENTE em billing-dev / staging até gate go-live.
-- Bucket privado `billing-nfse` é criado em runtime (ensureBucket), padrão commercial-proposals.

ALTER TABLE public.billing_nfse_documents
  ADD COLUMN IF NOT EXISTS dps_xml_storage_path text;

COMMENT ON COLUMN public.billing_nfse_documents.dps_xml_storage_path IS
  'Path no bucket billing-nfse do XML DPS assinado (auditoria).';
COMMENT ON COLUMN public.billing_nfse_documents.xml_storage_path IS
  'Path no bucket billing-nfse do XML NFS-e autorizado (gzip decodificado).';
COMMENT ON COLUMN public.billing_nfse_documents.pdf_storage_path IS
  'Path no bucket billing-nfse do DANFSe PDF (quando ADN retornar).';

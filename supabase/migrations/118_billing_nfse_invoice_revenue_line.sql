-- Sprint 5: coluna nullable para resolução de perfil NFS-e SaaS.
-- NULL = delivery (comportamento legado). Produto SaaS billing ainda não grava esta coluna.
-- Alternativa documentada: metadata de linha `nfse_revenue_line` / `revenue_line`.

ALTER TABLE public.billing_invoices
  ADD COLUMN IF NOT EXISTS revenue_line public.billing_nfse_revenue_line NULL;

COMMENT ON COLUMN public.billing_invoices.revenue_line IS
  'Linha de receita NFS-e (delivery | saas_monthly | saas_per_delivery). NULL = delivery. Sprint 5 — resolução de perfil; produto SaaS billing ainda não popula automaticamente.';

CREATE INDEX IF NOT EXISTS idx_billing_invoices_revenue_line
  ON public.billing_invoices (workspace_id, revenue_line)
  WHERE revenue_line IS NOT NULL;

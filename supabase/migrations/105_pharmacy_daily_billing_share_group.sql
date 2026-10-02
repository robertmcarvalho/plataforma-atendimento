-- Billing: grupos explícitos para rateio operacional de diárias.

CREATE TABLE IF NOT EXISTS public.billing_daily_share_groups (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id                uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name                        text NOT NULL,
  billing_cost_center_id      uuid REFERENCES public.billing_cost_centers(id) ON DELETE SET NULL,
  billing_pharmacy_id         uuid REFERENCES public.pharmacies(id) ON DELETE SET NULL,
  daily_pharmacy_amount_cents integer NOT NULL DEFAULT 0 CHECK (daily_pharmacy_amount_cents >= 0),
  daily_driver_payout_cents   integer CHECK (daily_driver_payout_cents IS NULL OR daily_driver_payout_cents >= 0),
  allocation_rule             text NOT NULL DEFAULT 'equal' CHECK (allocation_rule IN ('equal')),
  active                      boolean NOT NULL DEFAULT true,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  updated_at                  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_daily_share_groups_workspace_name_unique UNIQUE (workspace_id, name)
);

CREATE INDEX IF NOT EXISTS idx_billing_daily_share_groups_workspace_active
  ON public.billing_daily_share_groups (workspace_id, active);

CREATE INDEX IF NOT EXISTS idx_billing_daily_share_groups_cost_center
  ON public.billing_daily_share_groups (workspace_id, billing_cost_center_id)
  WHERE billing_cost_center_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.billing_daily_share_group_pharmacies (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  group_id    uuid NOT NULL REFERENCES public.billing_daily_share_groups(id) ON DELETE CASCADE,
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  active      boolean NOT NULL DEFAULT true,
  started_at  date,
  ended_at    date,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT billing_daily_share_group_pharmacies_unique UNIQUE (group_id, pharmacy_id)
);

CREATE INDEX IF NOT EXISTS idx_billing_daily_share_group_pharmacies_group
  ON public.billing_daily_share_group_pharmacies (workspace_id, group_id, active);

CREATE INDEX IF NOT EXISTS idx_billing_daily_share_group_pharmacies_pharmacy
  ON public.billing_daily_share_group_pharmacies (workspace_id, pharmacy_id, active);

COMMENT ON TABLE public.billing_daily_share_groups IS
  'Grupos operacionais que definem se uma diaria deve ser rateada e entre quais farmacias.';

COMMENT ON COLUMN public.billing_daily_share_groups.billing_cost_center_id IS
  'Centro de custo gerencial/faturavel relacionado ao grupo, sem determinar rateio por si so.';

COMMENT ON COLUMN public.billing_daily_share_groups.billing_pharmacy_id IS
  'Farmacia representante usada quando a fatura/boleto do polo deve sair centralizada.';

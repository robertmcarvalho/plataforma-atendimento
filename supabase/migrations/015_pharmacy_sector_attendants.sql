-- Atendente preferencial por farmácia + setor (opcional). Sem linha = usa fila padrão (primary_attendant / geral).

CREATE TABLE IF NOT EXISTS public.pharmacy_sector_attendants (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  pharmacy_id uuid NOT NULL REFERENCES public.pharmacies(id) ON DELETE CASCADE,
  sector_id uuid NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  attendant_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pharmacy_id, sector_id)
);

CREATE INDEX IF NOT EXISTS idx_pharmacy_sector_attendants_pharmacy
  ON public.pharmacy_sector_attendants(pharmacy_id);

CREATE INDEX IF NOT EXISTS idx_pharmacy_sector_attendants_sector
  ON public.pharmacy_sector_attendants(sector_id);

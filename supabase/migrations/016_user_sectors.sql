-- Usuário pode pertencer a vários setores (atendente). users.sector_id permanece como setor primário (espelho).

CREATE TABLE IF NOT EXISTS public.user_sectors (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  sector_id uuid NOT NULL REFERENCES public.sectors(id) ON DELETE CASCADE,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, sector_id)
);

CREATE INDEX IF NOT EXISTS idx_user_sectors_user_id ON public.user_sectors(user_id);
CREATE INDEX IF NOT EXISTS idx_user_sectors_sector_id ON public.user_sectors(sector_id);

INSERT INTO public.user_sectors (user_id, sector_id, is_primary)
SELECT u.id, u.sector_id, true
FROM public.users u
WHERE u.sector_id IS NOT NULL
ON CONFLICT (user_id, sector_id) DO NOTHING;

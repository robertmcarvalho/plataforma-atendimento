-- ==========================================================
-- MIGRATION 008 — Horário comercial canônico (setores/usuários)
-- ==========================================================

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS business_hours jsonb NOT NULL DEFAULT '{}';

-- Fallback global de timezone (workspace)
INSERT INTO app_settings (key, value)
VALUES ('workspace_timezone', '"America/Sao_Paulo"'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Mensagem opcional para auto-resposta fora do horário (texto; placeholders {{next_open_at}})
INSERT INTO app_settings (key, value)
VALUES (
  'auto_reply_out_of_hours',
  '"Obrigado pelo contato. No momento estamos fora do horario de atendimento. Voltamos em {{next_open_at}}."'::jsonb
)
ON CONFLICT (key) DO NOTHING;

-- Converte um dia legado PT {"start","end"} para formato weekly entry
CREATE OR REPLACE FUNCTION public._legacy_pt_day_to_entry(day_json jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN day_json IS NULL THEN '{"is_open":false,"intervals":[]}'::jsonb
    WHEN (day_json ? 'is_open') AND COALESCE((day_json->>'is_open')::boolean, true) = false
      THEN '{"is_open":false,"intervals":[]}'::jsonb
    WHEN day_json ? 'start' AND day_json ? 'end'
      THEN jsonb_build_object(
        'is_open', true,
        'intervals', jsonb_build_array(
          jsonb_build_object('start', day_json->>'start', 'end', day_json->>'end')
        )
      )
    ELSE '{"is_open":false,"intervals":[]}'::jsonb
  END;
$$;

CREATE OR REPLACE FUNCTION public.migrate_sectors_business_hours_to_canonical()
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  r RECORD;
  bh jsonb;
  weekly jsonb;
BEGIN
  FOR r IN SELECT id, business_hours FROM public.sectors
  LOOP
    bh := COALESCE(r.business_hours, '{}'::jsonb);
    IF bh ? 'weekly' THEN
      CONTINUE;
    END IF;

    weekly := jsonb_build_object(
      'monday',    public._legacy_pt_day_to_entry(bh->'seg'),
      'tuesday',   public._legacy_pt_day_to_entry(bh->'ter'),
      'wednesday', public._legacy_pt_day_to_entry(bh->'qua'),
      'thursday',  public._legacy_pt_day_to_entry(bh->'qui'),
      'friday',    public._legacy_pt_day_to_entry(bh->'sex'),
      'saturday',  public._legacy_pt_day_to_entry(bh->'sab'),
      'sunday',    public._legacy_pt_day_to_entry(bh->'dom')
    );

    -- Se não havia chaves PT mas havia algo (ex: formato antigo inglês), mantém fechado por dia
    IF weekly = '{"monday":{"is_open":false,"intervals":[]},"tuesday":{"is_open":false,"intervals":[]},"wednesday":{"is_open":false,"intervals":[]},"thursday":{"is_open":false,"intervals":[]},"friday":{"is_open":false,"intervals":[]},"saturday":{"is_open":false,"intervals":[]},"sunday":{"is_open":false,"intervals":[]}}'::jsonb
       AND bh != '{}'::jsonb
    THEN
      -- tenta chaves monday..sunday diretas com start/end (legado alternativo)
      weekly := jsonb_build_object(
        'monday',    public._legacy_pt_day_to_entry(bh->'monday'),
        'tuesday',   public._legacy_pt_day_to_entry(bh->'tuesday'),
        'wednesday', public._legacy_pt_day_to_entry(bh->'wednesday'),
        'thursday',  public._legacy_pt_day_to_entry(bh->'thursday'),
        'friday',    public._legacy_pt_day_to_entry(bh->'friday'),
        'saturday',  public._legacy_pt_day_to_entry(bh->'saturday'),
        'sunday',    public._legacy_pt_day_to_entry(bh->'sunday')
      );
    END IF;

    UPDATE public.sectors
    SET business_hours = jsonb_build_object(
      'timezone', COALESCE(bh->>'timezone', 'America/Sao_Paulo'),
      'weekly', weekly,
      'holidays', COALESCE(bh->'holidays', '[]'::jsonb)
    ),
    updated_at = now()
    WHERE id = r.id;
  END LOOP;
END;
$$;

SELECT public.migrate_sectors_business_hours_to_canonical();

-- Reforça fim de semana nos setores seed (sábado manhã, domingo fechado) quando ainda sem intervalos
UPDATE public.sectors
SET business_hours = jsonb_set(
  jsonb_set(
    business_hours,
    '{weekly,saturday}',
    '{"is_open":true,"intervals":[{"start":"08:00","end":"12:00"}]}'::jsonb,
    true
  ),
  '{weekly,sunday}',
  '{"is_open":false,"intervals":[]}'::jsonb,
  true
),
updated_at = now()
WHERE business_hours ? 'weekly'
  AND name IN ('Atendimento Geral', 'Financeiro', 'Operacional', 'Suporte Técnico');

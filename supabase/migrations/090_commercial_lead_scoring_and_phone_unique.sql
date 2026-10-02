-- Scoring IA comercial (metadados) + unicidade de telefone por workspace
-- Deduplica leads com mesmo (workspace_id, phone) antes do índice único.

ALTER TABLE public.commercial_leads
  ADD COLUMN IF NOT EXISTS ai_score_explanation text,
  ADD COLUMN IF NOT EXISTS ai_score_set_at timestamptz,
  ADD COLUMN IF NOT EXISTS ai_score_reason text;

-- ---------------------------------------------------------------------------
-- Deduplicação: mantém 1 lead por (workspace_id, phone)
-- Critério: convertido > tem conversa > updated_at mais recente > created_at
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE commercial_lead_phone_dedupe_pairs ON COMMIT DROP AS
WITH ranked AS (
  SELECT
    id,
    workspace_id,
    phone,
    ROW_NUMBER() OVER (
      PARTITION BY workspace_id, phone
      ORDER BY
        (converted_pharmacy_id IS NOT NULL) DESC,
        (primary_conversation_id IS NOT NULL) DESC,
        updated_at DESC NULLS LAST,
        created_at DESC NULLS LAST,
        id ASC
    ) AS rn
  FROM public.commercial_leads
  WHERE phone IS NOT NULL AND btrim(phone) <> ''
),
keepers AS (
  SELECT id AS keeper_id, workspace_id, phone
  FROM ranked
  WHERE rn = 1
),
losers AS (
  SELECT id AS loser_id, workspace_id, phone
  FROM ranked
  WHERE rn > 1
)
SELECT l.loser_id, k.keeper_id
FROM losers l
JOIN keepers k
  ON k.workspace_id = l.workspace_id AND k.phone = l.phone;

-- Enriquecer keeper com conversa do duplicado, se faltar
UPDATE public.commercial_leads kl
SET
  primary_conversation_id = COALESCE(
    kl.primary_conversation_id,
    src.primary_conversation_id
  ),
  updated_at = now()
FROM (
  SELECT DISTINCT ON (p.keeper_id)
    p.keeper_id,
    l.primary_conversation_id
  FROM commercial_lead_phone_dedupe_pairs p
  JOIN public.commercial_leads l ON l.id = p.loser_id
  WHERE l.primary_conversation_id IS NOT NULL
  ORDER BY p.keeper_id, l.updated_at DESC NULLS LAST
) src
WHERE kl.id = src.keeper_id
  AND kl.primary_conversation_id IS NULL;

UPDATE public.contacts c
SET commercial_lead_id = p.keeper_id, updated_at = now()
FROM commercial_lead_phone_dedupe_pairs p
WHERE c.commercial_lead_id = p.loser_id;

UPDATE public.conversations conv
SET context_commercial_lead_id = p.keeper_id, updated_at = now()
FROM commercial_lead_phone_dedupe_pairs p
WHERE conv.context_commercial_lead_id = p.loser_id;

UPDATE public.commercial_lead_activities a
SET lead_id = p.keeper_id
FROM commercial_lead_phone_dedupe_pairs p
WHERE a.lead_id = p.loser_id;

UPDATE public.commercial_proposals pr
SET lead_id = p.keeper_id, updated_at = now()
FROM commercial_lead_phone_dedupe_pairs p
WHERE pr.lead_id = p.loser_id;

UPDATE public.commercial_data_requests dr
SET lead_id = p.keeper_id, updated_at = now()
FROM commercial_lead_phone_dedupe_pairs p
WHERE dr.lead_id = p.loser_id;

INSERT INTO public.commercial_lead_activities (
  workspace_id,
  lead_id,
  activity_type,
  title,
  detail,
  metadata,
  created_by
)
SELECT
  kl.workspace_id,
  p.keeper_id,
  'note',
  'Lead duplicado mesclado (migração 090)',
  'Registro duplicado removido antes do índice único de telefone.',
  jsonb_build_object('merged_lead_id', p.loser_id, 'phone', kl.phone),
  NULL
FROM commercial_lead_phone_dedupe_pairs p
JOIN public.commercial_leads kl ON kl.id = p.keeper_id;

DELETE FROM public.commercial_leads cl
WHERE cl.id IN (SELECT loser_id FROM commercial_lead_phone_dedupe_pairs);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commercial_leads_workspace_phone_unique
  ON public.commercial_leads (workspace_id, phone)
  WHERE phone IS NOT NULL AND btrim(phone) <> '';

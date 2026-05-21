-- RPCs para matching por embedding e atualizacao incremental do centroide em ai_topics

CREATE OR REPLACE FUNCTION public.match_ai_topic_by_embedding(
  p_embedding vector(768),
  p_tenant_id uuid,
  p_threshold double precision
)
RETURNS TABLE (
  id uuid,
  name text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT x.id, x.name, x.similarity
  FROM (
    SELECT
      t.id,
      t.name,
      (1 - (t.centroid <=> p_embedding))::double precision AS similarity
    FROM public.ai_topics t
    WHERE t.tenant_id IS NOT DISTINCT FROM p_tenant_id
    ORDER BY t.centroid <=> p_embedding ASC
    LIMIT 1
  ) x
  WHERE x.similarity > p_threshold;
$$;

CREATE OR REPLACE FUNCTION public.merge_ai_topic_centroid(
  p_topic_id uuid,
  p_embedding vector(768)
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE public.ai_topics t
  SET
    centroid = (t.centroid * t.sample_count::double precision + p_embedding) / (t.sample_count + 1)::double precision,
    sample_count = t.sample_count + 1,
    updated_at = now()
  WHERE t.id = p_topic_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.nearest_ai_topic_by_embedding(
  p_embedding vector(768),
  p_tenant_id uuid
)
RETURNS TABLE (
  id uuid,
  name text,
  similarity double precision
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    t.id,
    t.name,
    (1 - (t.centroid <=> p_embedding))::double precision AS similarity
  FROM public.ai_topics t
  WHERE t.tenant_id IS NOT DISTINCT FROM p_tenant_id
  ORDER BY t.centroid <=> p_embedding ASC
  LIMIT 1;
$$;

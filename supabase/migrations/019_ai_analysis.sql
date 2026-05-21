-- IA: analise de sentimento, urgencia, NPS preditivo e agrupamento por topico (embeddings)
-- pgvector + colunas ai_* em messages/conversations + tabela ai_topics

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS public.ai_topics (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid NULL,
  name text NOT NULL,
  centroid vector(768) NOT NULL,
  sample_count int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS ai_sentiment text NULL CHECK (ai_sentiment IN ('positivo', 'neutro', 'negativo'));

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS ai_sentiment_score real NULL;

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS ai_urgency text NULL CHECK (ai_urgency IN ('alta', 'media', 'baixa'));

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS ai_urgency_score real NULL;

ALTER TABLE public.messages
ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamptz NULL;

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ai_sentiment_last text NULL CHECK (ai_sentiment_last IN ('positivo', 'neutro', 'negativo'));

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ai_urgency_score real NULL;

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ai_topic_id uuid NULL REFERENCES public.ai_topics(id) ON DELETE SET NULL;

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ai_topic_set_at timestamptz NULL;

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ai_topic_embedding vector(768) NULL;

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ai_nps_predicted int NULL CHECK (ai_nps_predicted BETWEEN 0 AND 10);

ALTER TABLE public.conversations
ADD COLUMN IF NOT EXISTS ai_nps_set_at timestamptz NULL;

CREATE INDEX IF NOT EXISTS idx_messages_ai_analyzed_at ON public.messages(ai_analyzed_at);
CREATE INDEX IF NOT EXISTS idx_conversations_ai_topic_id ON public.conversations(ai_topic_id);
CREATE INDEX IF NOT EXISTS idx_conversations_ai_urgency_score ON public.conversations(ai_urgency_score DESC);
CREATE INDEX IF NOT EXISTS idx_ai_topics_centroid_hnsw ON public.ai_topics USING hnsw (centroid vector_cosine_ops);

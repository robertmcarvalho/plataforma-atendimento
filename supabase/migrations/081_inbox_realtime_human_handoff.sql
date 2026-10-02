-- Realtime confiável na inbox + handoff humano (suprime OOH automático).

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS human_handoff_at timestamptz;

COMMENT ON COLUMN public.conversations.human_handoff_at IS
  'Primeira resposta humana pelo painel; suprime auto-respostas OOH enquanto ativo.';

ALTER TABLE public.messages REPLICA IDENTITY FULL;
ALTER TABLE public.conversations REPLICA IDENTITY FULL;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'conversations'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.conversations;
    END IF;
  END IF;
END $$;

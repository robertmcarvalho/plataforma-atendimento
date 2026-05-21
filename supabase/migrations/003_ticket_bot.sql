-- MIGRATION 003 — Ticket estruturado (summary + intent_sector_id)
-- Objetivo:
-- - Guardar um resumo curto editável no ticket (conversa)
-- - Guardar a intenção classificada pelo bot como setor (FK), sem depender do nome do setor

alter table public.conversations
  add column if not exists summary text;

alter table public.conversations
  add column if not exists intent_sector_id uuid references public.sectors(id) on delete set null;

create index if not exists idx_conversations_intent_sector_id
  on public.conversations (intent_sector_id);


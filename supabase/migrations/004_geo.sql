-- MIGRATION 004 — Geo (UF/Cidade) para entregadores

alter table public.drivers
  add column if not exists state text;


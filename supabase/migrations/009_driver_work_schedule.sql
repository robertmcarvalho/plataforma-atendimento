-- Migração para adicionar escala de trabalho aos entregadores
ALTER TABLE public.drivers
ADD COLUMN IF NOT EXISTS work_schedule jsonb NOT NULL DEFAULT '{}';

COMMENT ON COLUMN public.drivers.work_schedule IS 'Escala de trabalho semanal do entregador (formato canônico de business hours)';

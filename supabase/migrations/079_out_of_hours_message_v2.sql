-- ==========================================================
-- MIGRATION 079 — Mensagem fora do horário (copy legível pt-BR)
-- ==========================================================

DO $$
DECLARE
  new_message text := E'Olá! Obrigado pelo contato.\n\nNo momento estamos fora do horário de atendimento.\n\nRetornamos na {{next_open_at}}.\n\nPode deixar sua mensagem aqui — responderemos assim que voltarmos.';
BEGIN
  UPDATE public.app_settings
  SET value = to_jsonb(new_message)
  WHERE key = 'auto_reply_out_of_hours'
    AND trim(both '"' from value::text) IN (
      'Obrigado pelo contato. No momento estamos fora do horario de atendimento. Voltamos em {{next_open_at}}.',
      'Obrigado pelo contato. No momento estamos fora do horário de atendimento. Voltamos em {{next_open_at}}.'
    );

  UPDATE public.workspace_out_of_hours_rules
  SET message = new_message
  WHERE trim(message) IN (
    'Obrigado pelo contato. No momento estamos fora do horario de atendimento. Voltamos em {{next_open_at}}.',
    'Obrigado pelo contato. No momento estamos fora do horário de atendimento. Voltamos em {{next_open_at}}.'
  );

  UPDATE public.workspace_flow_messages
  SET content = new_message
  WHERE message_key = 'auto_reply_out_of_hours'
    AND trim(content) IN (
      'Obrigado pelo contato. No momento estamos fora do horario de atendimento. Voltamos em {{next_open_at}}.',
      'Obrigado pelo contato. No momento estamos fora do horário de atendimento. Voltamos em {{next_open_at}}.'
    );

  UPDATE public.workspace_channels
  SET config = jsonb_set(
    jsonb_set(
      config,
      '{messages,out_of_hours}',
      to_jsonb(new_message),
      true
    ),
    '{messages,foraHorario}',
    to_jsonb(new_message),
    true
  )
  WHERE trim(config #>> '{messages,out_of_hours}') IN (
    'Obrigado pelo contato. No momento estamos fora do horario de atendimento. Voltamos em {{next_open_at}}.',
    'Obrigado pelo contato. No momento estamos fora do horário de atendimento. Voltamos em {{next_open_at}}.'
  )
     OR trim(config #>> '{messages,foraHorario}') IN (
    'Obrigado pelo contato. No momento estamos fora do horario de atendimento. Voltamos em {{next_open_at}}.',
    'Obrigado pelo contato. No momento estamos fora do horário de atendimento. Voltamos em {{next_open_at}}.'
  );
END $$;

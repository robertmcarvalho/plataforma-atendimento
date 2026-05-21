-- Permite gatilho "Conversa resolvida" em bindings (ex.: fluxo Pesquisa CSAT).

ALTER TABLE public.conversation_flow_bindings
  DROP CONSTRAINT IF EXISTS conversation_flow_bindings_trigger_type_check;

ALTER TABLE public.conversation_flow_bindings
  ADD CONSTRAINT conversation_flow_bindings_trigger_type_check
  CHECK (
    trigger_type IN (
      'conversation_started',
      'message_received',
      'keyword',
      'conversation_resolved'
    )
  );

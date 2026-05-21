-- Canal interno por workspace para credenciais do provedor LLM (BYOK), alinhado a workspace_channels.

ALTER TABLE public.workspace_channels DROP CONSTRAINT IF EXISTS workspace_channels_channel_type_check;

ALTER TABLE public.workspace_channels ADD CONSTRAINT workspace_channels_channel_type_check
  CHECK (channel_type IN ('whatsapp', 'instagram', 'email', 'webchat', 'llm'));

COMMENT ON CONSTRAINT workspace_channels_channel_type_check ON public.workspace_channels IS
  'whatsapp|instagram|email|webchat = mensageria; llm = Gemini/API keys por workspace';

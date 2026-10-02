import { PubSub } from '@google-cloud/pubsub';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@plataforma/logger';

export const pubsub = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID });
export const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
export const logger = createLogger('orchestrator-service');
/** Logger-backed console (evita conflito com global). */
export const orchestratorConsole = logger.console;

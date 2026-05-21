import { createLogger } from '@plataforma/logger';
import { supabase } from './supabase';

const logger = createLogger('api-service');

export async function writeAuditLog(input: {
  actor_id: string | null;
  action: string;
  entity_type?: string | null;
  entity_id?: string | null;
  workspace_id?: string | null;
  correlation_id?: string | null;
  request_id?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  try {
    const { error } = await supabase.from('audit_logs').insert({
      actor_id: input.actor_id,
      action: input.action,
      entity_type: input.entity_type ?? null,
      entity_id: input.entity_id ?? null,
      workspace_id: input.workspace_id ?? null,
      metadata: {
        ...(input.metadata ?? {}),
        ...(input.correlation_id ? { correlation_id: input.correlation_id } : {}),
        ...(input.request_id ? { request_id: input.request_id } : {}),
      },
    });
    if (error && (error.message || '').includes('does not exist')) return;
    if (error) logger.warn('audit_logs write failed', { error });
  } catch {
    /* ignore */
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';

const TERMINATION_TASK_TYPES = [
  'driver_termination_prep',
  'driver_termination_request',
  'driver_termination_financial_review',
] as const;

/**
 * Evita criar "Finalizar cadastro" para entregador já cadastrado ou em pipeline de desligamento.
 */
export async function shouldSkipDriverRegistrationTask(
  db: SupabaseClient,
  workspaceId: string,
  driverId: string
): Promise<boolean> {
  const { data: driver } = await db
    .from('drivers')
    .select('doc_status, tags')
    .eq('workspace_id', workspaceId)
    .eq('id', driverId)
    .maybeSingle();

  const tags = Array.isArray(driver?.tags) ? driver.tags.map(String) : [];
  if (String(driver?.doc_status || '') === 'ok' && !tags.includes('cadastro-pendente')) {
    return true;
  }

  const { data: termination } = await db
    .from('pending_tasks')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('driver_id', driverId)
    .in('task_type', [...TERMINATION_TASK_TYPES])
    .in('status', ['open', 'in_progress'])
    .limit(1)
    .maybeSingle();

  return Boolean(termination?.id);
}

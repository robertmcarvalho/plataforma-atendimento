import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getFluxDeliveryClient,
  isFluxDeliverySkipped,
  resolveFluxSyncWorkspaceId,
  runFluxDeliverySyncForWorkspace,
} from '@plataforma/flux-delivery';

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function lookbackDays(): number {
  const n = Number(process.env.FLUX_DELIVERY_SYNC_LOOKBACK_DAYS || 7);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 31) : 7;
}

/** Janela incremental: última entrega no banco − 1 dia, limitada pelo lookback máximo. */
async function resolveSyncPeriod(
  db: SupabaseClient,
  workspaceId: string
): Promise<{ dataInicio: string; dataFim: string }> {
  const end = new Date();
  const maxLookback = lookbackDays();
  const defaultStart = new Date(end);
  defaultStart.setUTCDate(end.getUTCDate() - maxLookback);

  const { data: lastRow } = await db
    .from('billing_delivery_records')
    .select('delivered_at')
    .eq('workspace_id', workspaceId)
    .order('delivered_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let start = defaultStart;
  if (lastRow?.delivered_at) {
    const incremental = new Date(String(lastRow.delivered_at));
    if (!Number.isNaN(incremental.getTime())) {
      incremental.setUTCDate(incremental.getUTCDate() - 1);
      if (incremental > defaultStart) start = incremental;
    }
  }

  return { dataInicio: formatDate(start), dataFim: formatDate(end) };
}

export function registerFluxDeliverySyncJobs(db: SupabaseClient, timezone: string) {
  return {
    timezone,
    runFluxDeliverySyncJob: () => runFluxDeliverySyncJob(db),
  };
}

async function runFluxDeliverySyncJob(db: SupabaseClient) {
  if (process.env.FLUX_DELIVERY_SYNC_ENABLED === 'false') return null;
  if (isFluxDeliverySkipped()) return null;

  const fluxClient = getFluxDeliveryClient();
  if (!fluxClient) {
    throw new Error('Flux Delivery não configurado para sync de entregas');
  }

  const workspaceId = await resolveFluxSyncWorkspaceId(db);
  if (!workspaceId) throw new Error('Nenhum workspace para sync Flux entregas');

  const { dataInicio, dataFim } = await resolveSyncPeriod(db, workspaceId);

  return runFluxDeliverySyncForWorkspace(db, {
    workspaceId,
    fluxClient,
    dataInicio,
    dataFim,
  });
}

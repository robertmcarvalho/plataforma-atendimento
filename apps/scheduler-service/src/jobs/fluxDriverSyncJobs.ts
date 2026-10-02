import type { SupabaseClient } from '@supabase/supabase-js';
import {
  getFluxDeliveryClient,
  isFluxDeliverySkipped,
  resolveFluxSyncWorkspaceId,
  runFluxDriverSyncForWorkspace,
  type FluxDriverSyncResult,
} from '@plataforma/flux-delivery';

export function registerFluxDriverSyncJobs(db: SupabaseClient, timezone: string) {
  return {
    timezone,
    runFluxDriverSyncJob: () => runFluxDriverSyncJob(db),
  };
}

async function runFluxDriverSyncJob(db: SupabaseClient): Promise<FluxDriverSyncResult | null> {
  if (process.env.FLUX_DRIVER_SYNC_ENABLED === 'false') {
    return null;
  }
  if (isFluxDeliverySkipped()) {
    return null;
  }

  const fluxClient = getFluxDeliveryClient();
  if (!fluxClient) {
    throw new Error('Flux Delivery não configurado (FLUX_DELIVERY_* ausentes ou FLUX_DELIVERY_SKIP=true)');
  }

  const workspaceId = await resolveFluxSyncWorkspaceId(db);
  if (!workspaceId) {
    throw new Error('Nenhum workspace encontrado para sync Flux');
  }

  const forceOverwrite = process.env.FLUX_DRIVER_SYNC_FORCE === 'true';
  const pageSize = Number(process.env.FLUX_DRIVER_SYNC_PAGE_SIZE || 50);

  return runFluxDriverSyncForWorkspace(db, {
    workspaceId,
    fluxClient,
    forceOverwrite,
    pageSize: Number.isFinite(pageSize) ? pageSize : 50,
  });
}

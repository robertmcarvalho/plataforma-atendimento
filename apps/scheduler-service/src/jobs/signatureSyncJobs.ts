import type { SupabaseClient } from '@supabase/supabase-js';
import { runSignatureSyncForWorkspace } from '../lib/signatureStatusSync';

export function registerSignatureSyncJobs(db: SupabaseClient, timezone: string) {
  return {
    timezone,
    runSignatureSyncJob: () => runSignatureSyncJob(db),
  };
}

async function runSignatureSyncJob(db: SupabaseClient) {
  const { data: workspaces, error } = await db.from('workspaces').select('id');
  if (error) throw error;
  if (!workspaces?.length) return { synced: 0, workspaces: 0 };

  let synced = 0;
  for (const ws of workspaces) {
    const result = await runSignatureSyncForWorkspace(db, String(ws.id));
    synced += result.synced || 0;
  }
  return { synced, workspaces: workspaces.length };
}

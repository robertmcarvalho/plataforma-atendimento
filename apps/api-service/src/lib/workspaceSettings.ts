import type { SupabaseClient } from '@supabase/supabase-js';
import { supabase } from './supabase';

export async function listWorkspaceSettings(workspaceId: string, db: SupabaseClient = supabase) {
  const { data, error } = await db.from('app_settings').select('key, value').eq('workspace_id', workspaceId);
  if (error) throw new Error(error.message);
  return data || [];
}

export async function readWorkspaceSetting(workspaceId: string, key: string, db: SupabaseClient = supabase): Promise<unknown> {
  const { data, error } = await db
    .from('app_settings')
    .select('value')
    .eq('workspace_id', workspaceId)
    .eq('key', key)
    .maybeSingle();

  if (error && !(error.message || '').includes('does not exist')) throw new Error(error.message);
  return data?.value ?? null;
}

export async function upsertWorkspaceSetting(workspaceId: string, key: string, value: unknown, db: SupabaseClient = supabase) {
  const { error } = await db
    .from('app_settings')
    .upsert(
      {
        workspace_id: workspaceId,
        key,
        value: value as never,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'workspace_id,key' }
    );

  if (error) throw new Error(error.message);
}

import { supabase } from '../supabase';

const COMMERCIAL_ROLE_DEFS = [
  {
    name: 'commercial',
    permissions: {
      commercial: { view: true, manage: true },
      conversations: { view: true, reply: true },
    },
  },
  {
    name: 'sales',
    permissions: {
      commercial: { view: true, manage: true },
      conversations: { view: true, reply: true },
    },
  },
] as const;

/** Garante roles `commercial` e `sales` no workspace (idempotente). */
export async function ensureCommercialRoles(workspaceId: string): Promise<void> {
  for (const def of COMMERCIAL_ROLE_DEFS) {
    const { data: existing } = await supabase
      .from('roles')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('name', def.name)
      .maybeSingle();
    if (existing?.id) continue;

    await supabase.from('roles').insert({
      workspace_id: workspaceId,
      name: def.name,
      permissions: def.permissions,
    });
  }
}

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Desativa líder e remove vínculos estruturais (farmácias, links, override em entregadores).
 * Não apaga a linha em `leaders`.
 */
export async function demoteLeaderStructural(db: SupabaseClient, leaderId: string): Promise<void> {
  const now = new Date().toISOString();

  await db.from('contacts').update({ leader_id: null, updated_at: now }).eq('leader_id', leaderId);

  await db.from('leader_pharmacy_links').update({ is_active: false }).eq('leader_id', leaderId);

  await db.from('pharmacies').update({ leader_id: null, updated_at: now }).eq('leader_id', leaderId);

  await db.from('drivers').update({ override_leader_id: null, updated_at: now }).eq('override_leader_id', leaderId);

  await db.from('leaders').update({ status: 'inactive', user_id: null, updated_at: now }).eq('id', leaderId);
}

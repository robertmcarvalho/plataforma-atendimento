import type { SupabaseClient } from '@supabase/supabase-js';
import { normalizeBrazilPhone } from './excelCadastroImport';
import { demoteLeaderStructural } from './leaderStructuralDemotion';

type DriverLeaderSyncInput = {
  workspace_id: string;
  phone?: string | null;
  /** Telefone anterior do entregador (PUT): permite desativar líder no número antigo se mudou junto com is_leader. */
  previous_phone?: string | null;
  name?: string | null;
  email?: string | null;
  is_leader?: boolean | null;
  primary_pharmacy_id?: string | null;
};

type DriverLeaderSyncResult = {
  override_leader_id: string | null;
};

export async function syncDriverLeaderContext(
  db: SupabaseClient,
  input: DriverLeaderSyncInput
): Promise<DriverLeaderSyncResult> {
  const primaryPharmacyId = input.primary_pharmacy_id || null;
  let overrideLeaderId: string | null = null;

  const normalizedPhoneForLeader = normalizeBrazilPhone(String(input.phone || ''));
  const normalizedPrev = input.previous_phone ? normalizeBrazilPhone(String(input.previous_phone)) : '';

  if (!input.is_leader) {
    const phonesToDemote = new Set<string>();
    if (normalizedPhoneForLeader) phonesToDemote.add(normalizedPhoneForLeader);
    if (normalizedPrev && normalizedPrev !== normalizedPhoneForLeader) phonesToDemote.add(normalizedPrev);

    for (const phone of phonesToDemote) {
      const { data: leaderRow } = await db
        .from('leaders')
        .select('id')
        .eq('workspace_id', input.workspace_id)
        .eq('phone', phone)
        .maybeSingle();
      const leaderId = leaderRow?.id as string | undefined;
      if (leaderId) await demoteLeaderStructural(db, leaderId);
    }
  }

  if (input.is_leader) {
    if (normalizedPhoneForLeader) {
      const payload = {
        workspace_id: input.workspace_id,
        phone: normalizedPhoneForLeader,
        name: String(input.name || 'Sem nome'),
        email: input.email || null,
        status: 'active',
        updated_at: new Date().toISOString(),
      };
      const { error } = await db.from('leaders').upsert(payload, { onConflict: 'workspace_id,phone' });
      if (error) {
        throw new Error(`Falha ao sincronizar líder (telefone): ${error.message}`);
      }
    }
  }

  if (primaryPharmacyId) {
    const { data } = await db
      .from('pharmacies')
      .select('leader_id')
      .eq('workspace_id', input.workspace_id)
      .eq('id', primaryPharmacyId)
      .maybeSingle();
    overrideLeaderId = data?.leader_id || null;
  }

  return { override_leader_id: overrideLeaderId };
}

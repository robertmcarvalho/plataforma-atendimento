import { canonicalBrazilWaPhone, waPhoneLookupVariants } from '@plataforma/channel-runtime';
import type { SupabaseClient } from '@supabase/supabase-js';

export function normalizeWaPhoneForStorage(input: string): string {
  const canonical = canonicalBrazilWaPhone(input);
  if (canonical) return canonical;
  const d = String(input || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('55') && d.length >= 12) return d;
  if (d.length >= 10 && d.length <= 11) return `55${d}`;
  return d;
}

function pickPreferredContact(
  rows: Record<string, unknown>[],
  canonicalPhone: string,
): Record<string, unknown> | null {
  if (!rows.length) return null;

  const exact = rows.find((row) => String(row.wa_phone || '') === canonicalPhone);
  if (exact) return exact;

  const linked = rows.find(
    (row) => row.driver_id || row.pharmacy_id || row.leader_id || row.commercial_lead_id,
  );
  if (linked) return linked;

  return [...rows].sort((a, b) => {
    const aTs = Date.parse(String(a.updated_at || a.created_at || 0));
    const bTs = Date.parse(String(b.updated_at || b.created_at || 0));
    return bTs - aTs;
  })[0]!;
}

export async function findContactsByWaPhoneVariants(
  db: SupabaseClient,
  workspaceId: string,
  inputPhone: string,
): Promise<Record<string, unknown>[]> {
  const variants = waPhoneLookupVariants(normalizeWaPhoneForStorage(inputPhone));
  if (!variants.length) return [];

  const withPlus = variants.flatMap((v) => (v.startsWith('+') ? [v] : [v, `+${v}`]));
  const uniqueVariants = [...new Set(withPlus)];

  const { data, error } = await db
    .from('contacts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .in('wa_phone', uniqueVariants);

  if (error) throw error;
  return (data as Record<string, unknown>[] | null) ?? [];
}

export async function findContactByWaPhone(
  db: SupabaseClient,
  workspaceId: string,
  inputPhone: string,
): Promise<Record<string, unknown> | null> {
  const waPhone = normalizeWaPhoneForStorage(inputPhone);
  const matches = await findContactsByWaPhoneVariants(db, workspaceId, waPhone);
  return pickPreferredContact(matches, waPhone);
}

function supabaseErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === 'string' && message.trim()) return message;
  }
  return 'Falha ao resolver contato';
}

export async function upsertContactByWaPhone(
  db: SupabaseClient,
  workspaceId: string,
  inputPhone: string,
  payload: Record<string, unknown>,
): Promise<{ contact: Record<string, unknown>; created: boolean }> {
  const waPhone = normalizeWaPhoneForStorage(inputPhone);
  const matches = await findContactsByWaPhoneVariants(db, workspaceId, waPhone);
  const existing = pickPreferredContact(matches, waPhone);
  const row = { ...payload, workspace_id: workspaceId, wa_phone: waPhone, updated_at: new Date().toISOString() };

  if (existing?.id) {
    // Never rename a variant row onto a phone that already belongs to another contact.
    // Prefer updating the canonical row; if we only have a variant, normalize only when safe.
    const existingPhone = String(existing.wa_phone || '');
    if (existingPhone !== waPhone) {
      const exact = matches.find((m) => String(m.wa_phone || '') === waPhone);
      if (exact?.id && String(exact.id) !== String(existing.id)) {
        const { data, error } = await db
          .from('contacts')
          .update({ ...payload, workspace_id: workspaceId, updated_at: row.updated_at })
          .eq('workspace_id', workspaceId)
          .eq('id', exact.id)
          .select()
          .single();
        if (error) throw new Error(supabaseErrorMessage(error));
        return { contact: data as Record<string, unknown>, created: false };
      }
    }

    const { data, error } = await db
      .from('contacts')
      .update(row)
      .eq('workspace_id', workspaceId)
      .eq('id', existing.id)
      .select()
      .single();
    if (error) throw new Error(supabaseErrorMessage(error));
    return { contact: data as Record<string, unknown>, created: false };
  }

  const { data, error } = await db.from('contacts').insert(row).select().single();
  if (error?.code === '23505') {
    const retryMatches = await findContactsByWaPhoneVariants(db, workspaceId, waPhone);
    const retry = pickPreferredContact(retryMatches, waPhone);
    if (retry?.id) {
      const upd = await db
        .from('contacts')
        .update({ ...payload, workspace_id: workspaceId, updated_at: row.updated_at })
        .eq('workspace_id', workspaceId)
        .eq('id', retry.id)
        .select()
        .single();
      if (upd.error) throw new Error(supabaseErrorMessage(upd.error));
      return { contact: upd.data as Record<string, unknown>, created: false };
    }
  }
  if (error) throw new Error(supabaseErrorMessage(error));
  return { contact: data as Record<string, unknown>, created: true };
}

/**
 * Ensure a contact row for a leader WhatsApp identity.
 * Prefer existing leader_id link; else attach to phone-variant contact (keeping driver/pharmacy
 * profile when present); else insert. Avoids idx_contacts_workspace_phone_unique collisions.
 */
export async function ensureLeaderContactByWaPhone(
  db: SupabaseClient,
  workspaceId: string,
  leaderId: string,
  inputPhone: string,
  leaderName: string | null | undefined,
): Promise<{ contact: Record<string, unknown>; created: boolean }> {
  // Multiple leader_id rows can exist (+E.164 vs digits). Prefer canonical phone; never maybeSingle.
  const { data: linkedRows } = await db
    .from('contacts')
    .select('*')
    .eq('workspace_id', workspaceId)
    .eq('leader_id', leaderId)
    .order('updated_at', { ascending: false });
  const linkedList = (linkedRows as Record<string, unknown>[] | null) ?? [];
  if (linkedList.length) {
    const waPhone = normalizeWaPhoneForStorage(inputPhone);
    const preferred =
      (waPhone && linkedList.find((r) => String(r.wa_phone || '') === waPhone)) ||
      linkedList.find((r) => String(r.wa_phone || '').replace(/\D/g, '') === waPhone) ||
      linkedList[0]!;
    return { contact: preferred, created: false };
  }

  const waPhone =
    normalizeWaPhoneForStorage(inputPhone) ||
    (String(inputPhone || '').replace(/\D/g, '') ? String(inputPhone).replace(/\D/g, '') : '');
  if (!waPhone) {
    throw new Error('Telefone do líder inválido para criar contato');
  }

  const matches = await findContactsByWaPhoneVariants(db, workspaceId, waPhone);
  const existing = pickPreferredContact(matches, waPhone);
  const now = new Date().toISOString();

  if (existing?.id) {
    const keepsOtherProfile = Boolean(existing.driver_id || existing.pharmacy_id || existing.commercial_lead_id);
    const patch: Record<string, unknown> = {
      leader_id: leaderId,
      updated_at: now,
    };
    if (!keepsOtherProfile) {
      patch.profile_type = 'leader';
      if (leaderName) patch.display_name = leaderName;
      // Normalize legacy "+55..." onto digits when safe (no other exact canonical row).
      if (String(existing.wa_phone || '') !== waPhone) {
        const exact = matches.find((m) => String(m.wa_phone || '') === waPhone);
        if (!exact || String(exact.id) === String(existing.id)) {
          patch.wa_phone = waPhone;
        }
      }
    }

    const { data, error } = await db
      .from('contacts')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('id', existing.id)
      .select()
      .single();
    if (error?.code === '23505') {
      const retry = await db
        .from('contacts')
        .update({ leader_id: leaderId, updated_at: now })
        .eq('workspace_id', workspaceId)
        .eq('id', existing.id)
        .select()
        .single();
      if (retry.error) throw new Error(supabaseErrorMessage(retry.error));
      return { contact: retry.data as Record<string, unknown>, created: false };
    }
    if (error) throw new Error(supabaseErrorMessage(error));
    return { contact: data as Record<string, unknown>, created: false };
  }

  return upsertContactByWaPhone(db, workspaceId, waPhone, {
    display_name: leaderName || null,
    profile_type: 'leader',
    leader_id: leaderId,
  });
}

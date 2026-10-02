import { supabase } from './supabase';

/** Localiza usuário no Supabase Auth por e-mail (paginação admin.listUsers). */
export async function findAuthUserIdByEmail(email: string): Promise<string | null> {
  const wanted = String(email || '').trim().toLowerCase();
  if (!wanted) return null;

  const perPage = 200;
  for (let page = 1; page <= 10; page += 1) {
    const res = await supabase.auth.admin.listUsers({ page, perPage });
    if (res.error) throw new Error(res.error.message);

    const users = (res.data?.users || []) as Array<{ id?: string; email?: string | null }>;
    const found = users.find((u) => String(u.email || '').trim().toLowerCase() === wanted);
    if (found?.id) return String(found.id);

    if (users.length < perPage) break;
  }

  return null;
}

function isCorruptAuthAdminError(message: string | undefined): boolean {
  const m = (message || '').toLowerCase();
  return m.includes('database error loading user');
}

async function repairMigratedAuthUserRow(userId: string): Promise<void> {
  const { error } = await supabase.rpc('repair_auth_user_null_tokens', { p_user_id: userId });
  if (error) {
    throw new Error(
      `Conta Auth inconsistente (${error.message}). Execute o script repair-migrated-auth-user.mjs para este e-mail.`
    );
  }
}

/**
 * Define senha no Supabase Auth. Repara registros migrados com tokens NULL quando necessário.
 */
export async function setAuthUserPassword(userId: string, password: string): Promise<{ repaired: boolean }> {
  const first = await supabase.auth.admin.updateUserById(userId, { password });
  if (!first.error) return { repaired: false };

  if (!isCorruptAuthAdminError(first.error.message)) {
    throw first.error;
  }

  await repairMigratedAuthUserRow(userId);

  const second = await supabase.auth.admin.updateUserById(userId, { password });
  if (second.error) throw second.error;

  return { repaired: true };
}

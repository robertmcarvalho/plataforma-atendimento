import { createClient } from '@supabase/supabase-js';

/**
 * Valida senha com cliente anon (não polui o client service-role nem cria sessão persistente).
 */
export async function verifyUserPassword(email: string, password: string): Promise<boolean> {
  const url = process.env.SUPABASE_URL?.trim();
  const anonKey =
    process.env.SUPABASE_ANON_KEY?.trim() || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() || '';
  if (!url || !anonKey) {
    throw new Error('SUPABASE_ANON_KEY não configurada no api-service (necessária para validar senha atual).');
  }

  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) return false;

  await client.auth.signOut().catch(() => undefined);
  return true;
}

import { supabase } from './supabase';

/**
 * Valida a senha atual no mesmo projeto Supabase usado no login (SUPABASE_URL + service role).
 * Não usar SUPABASE_ANON_KEY de outro projeto — após o cutover omhlb/ojzzx isso invalidava a troca de senha.
 */
export async function verifyUserPassword(email: string, password: string): Promise<boolean> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.user) return false;

  await supabase.auth.signOut().catch(() => undefined);
  return true;
}

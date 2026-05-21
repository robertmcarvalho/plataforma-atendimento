import crypto from 'crypto';
import { supabase } from './supabase';

export function generateTemporaryPassword(length = 16): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$%';
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) out += chars[bytes[i]! % chars.length];
  return out;
}

export async function generateUsername(workspaceId: string, name: string, email: string): Promise<string> {
  const { data: workspace } = await supabase.from('workspaces').select('slug').eq('id', workspaceId).maybeSingle();
  const slug = String(workspace?.slug || 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20);
  const base = name
    .trim()
    .split(/\s+/)[0]
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, '') || email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'user';
  let candidate = `${base}.${slug}`.slice(0, 48);
  for (let i = 0; i < 20; i++) {
    const { data } = await supabase.from('users').select('id').eq('username', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}.${slug}${i + 2}`.slice(0, 48);
  }
  return `${base}.${slug}.${Date.now().toString(36)}`.slice(0, 48);
}

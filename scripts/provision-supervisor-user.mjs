/**
 * Provisiona um usuário supervisor no workspace (Auth + users + workspace_memberships + user_sectors + filas WhatsApp).
 *
 * Credenciais: apps/api-service/.env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY).
 *
 * Sobrescreva via env:
 *   SUPERVISOR_EMAIL, SUPERVISOR_NAME, SUPERVISOR_PHONE,
 *   SECTOR_NAME (default: Operacional),
 *   CHANNEL_MATCH (substring case-insensitive no display_name da fila, default: principal),
 *   WORKSPACE_SLUG (default: default)
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

function parseEnvFile(filePath) {
  if (!existsSync(filePath)) return new Map();
  const values = new Map();
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    values.set(key, value);
  }
  return values;
}

function resolveSupabaseSettings() {
  const envPath = path.join(process.cwd(), 'apps', 'api-service', '.env');
  const envValues = parseEnvFile(envPath);
  const url = process.env.SUPABASE_URL || envValues.get('SUPABASE_URL');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || envValues.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url) throw new Error('SUPABASE_URL ausente (apps/api-service/.env ou env var)');
  if (!serviceKey) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente');
  return { url, serviceKey };
}

function generatePassword() {
  const raw = crypto.randomBytes(16).toString('base64url');
  return `Dev@${raw.slice(0, 14)}!`;
}

async function generateUsername(supabase, workspaceId, name, email) {
  const { data: workspace } = await supabase.from('workspaces').select('slug').eq('id', workspaceId).maybeSingle();
  const slug = String(workspace?.slug || 'workspace')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '')
    .slice(0, 20);
  const base =
    name
      .trim()
      .split(/\s+/)[0]
      ?.toLowerCase()
      .replace(/[^a-z0-9]/g, '') ||
    email.split('@')[0]?.toLowerCase().replace(/[^a-z0-9]/g, '') ||
    'user';
  let candidate = `${base}.${slug}`.slice(0, 48);
  for (let i = 0; i < 20; i++) {
    const { data } = await supabase.from('users').select('id').eq('username', candidate).maybeSingle();
    if (!data) return candidate;
    candidate = `${base}.${slug}${i + 2}`.slice(0, 48);
  }
  return `${base}.${slug}.${Date.now().toString(36)}`.slice(0, 48);
}

async function replaceUserSectors(supabase, userId, workspaceId, sectorId) {
  const now = new Date().toISOString();
  await supabase.from('user_sectors').delete().eq('user_id', userId).eq('workspace_id', workspaceId);
  const { error } = await supabase.from('user_sectors').insert({
    workspace_id: workspaceId,
    user_id: userId,
    sector_id: sectorId,
    is_primary: true,
    updated_at: now,
  });
  if (error) throw new Error(`user_sectors: ${error.message}`);
}

async function upsertWorkspaceMembership(supabase, { workspace_id, user_id, role_id }) {
  const now = new Date().toISOString();
  const { error } = await supabase.from('workspace_memberships').upsert(
    {
      workspace_id,
      user_id,
      role_id,
      is_active: true,
      is_default: true,
      updated_at: now,
    },
    { onConflict: 'workspace_id,user_id' }
  );
  if (error) throw new Error(`workspace_memberships: ${error.message}`);

  const { error: flipError } = await supabase
    .from('workspace_memberships')
    .update({ is_default: false, updated_at: now })
    .eq('user_id', user_id)
    .neq('workspace_id', workspace_id)
    .eq('is_default', true);
  if (flipError) throw new Error(`workspace_memberships flip: ${flipError.message}`);
}

async function setChannelAssignment(supabase, workspaceId, userId, channelId, sectorId) {
  const now = new Date().toISOString();
  await supabase.from('user_channel_queue_assignments').delete().eq('workspace_id', workspaceId).eq('user_id', userId);
  const { error } = await supabase.from('user_channel_queue_assignments').insert({
    workspace_id: workspaceId,
    user_id: userId,
    workspace_channel_id: channelId,
    queue_name: sectorId,
    is_enabled: true,
    updated_at: now,
  });
  if (error) throw new Error(`user_channel_queue_assignments: ${error.message}`);
}

async function main() {
  const { url, serviceKey } = resolveSupabaseSettings();
  const supabase = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const email =
    process.env.SUPERVISOR_EMAIL || 'rbtcarvalhi@gmail.com';
  const name =
    process.env.SUPERVISOR_NAME || 'Robert Magdiel de Carvalho';
  const phone =
    process.env.SUPERVISOR_PHONE || '+5534996710044';
  const sectorName = (process.env.SECTOR_NAME || 'Operacional').trim();
  const channelMatch = (process.env.CHANNEL_MATCH || 'principal').trim().toLowerCase();
  const workspaceSlug = (process.env.WORKSPACE_SLUG || 'default').trim();
  const { data: ws, error: wsErr } = await supabase
    .from('workspaces')
    .select('id, slug, display_name')
    .eq('slug', workspaceSlug)
    .maybeSingle();
  if (wsErr) throw wsErr;
  if (!ws?.id) throw new Error(`Workspace slug não encontrado: ${workspaceSlug}`);

  const workspaceId = ws.id;

  const { data: supervisorRole, error: roleErr } = await supabase
    .from('roles')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .eq('name', 'supervisor')
    .maybeSingle();
  if (roleErr) throw roleErr;
  if (!supervisorRole?.id) {
    throw new Error(
      `Role 'supervisor' não existe neste workspace. Crie o perfil em Configurações ou rode o seed adequado (workspace_id=${workspaceId}).`
    );
  }

  const { data: sectors, error: secErr } = await supabase
    .from('sectors')
    .select('id, name')
    .eq('workspace_id', workspaceId)
    .ilike('name', sectorName);
  if (secErr) throw secErr;
  const sectorRow = sectors?.find((s) => String(s.name).trim().toLowerCase() === sectorName.toLowerCase()) || sectors?.[0];
  if (!sectorRow?.id) {
    const names = (sectors || []).map((s) => s.name).join(', ') || '(nenhum com ilike)';
    throw new Error(
      `Setor '${sectorName}' não encontrado no workspace. Setores próximos: ${names}. Ajuste SECTOR_NAME ou crie o setor.`
    );
  }

  const { data: waChannels, error: chErr } = await supabase
    .from('workspace_channels')
    .select('id, display_name, channel_type, is_default')
    .eq('workspace_id', workspaceId)
    .eq('channel_type', 'whatsapp')
    .eq('is_active', true);
  if (chErr) throw chErr;
  const normalized = channelMatch.normalize('NFD').replace(/\p{M}/gu, '');
  const matchChannel = (c) =>
    String(c.display_name || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/\p{M}/gu, '')
      .includes(normalized);

  let channel =
    (waChannels || []).find((c) => matchChannel(c) && c.is_default) ||
    (waChannels || []).find(matchChannel) ||
    (waChannels || []).find((c) => c.is_default) ||
    (waChannels || [])[0];

  if (!channel?.id) {
    throw new Error(
      `Nenhum canal WhatsApp ativo no workspace. Configure integrações primeiro (CHANNEL_MATCH='${channelMatch}').`
    );
  }

  const { data: listed, error: listErr } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (listErr) throw listErr;
  const existing = (listed?.users || []).find((u) => (u.email || '').toLowerCase() === email.toLowerCase());

  let password = generatePassword();
  let authUser;

  if (existing) {
    const { data, error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    authUser = data.user;
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });
    if (error) throw error;
    authUser = data.user;
  }

  if (!authUser?.id) throw new Error('Falha auth user');

  let username =
    (
      await supabase.from('users').select('username').eq('id', authUser.id).maybeSingle()
    ).data?.username || null;
  if (!username) username = await generateUsername(supabase, workspaceId, name, email);

  const { error: upsertErr } = await supabase.from('users').upsert(
    {
      id: authUser.id,
      name,
      email,
      phone,
      role_id: supervisorRole.id,
      sector_id: sectorRow.id,
      username,
      must_change_password: true,
      provisioned_at: new Date().toISOString(),
      is_active: true,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'id' }
  );
  if (upsertErr) throw upsertErr;

  await replaceUserSectors(supabase, authUser.id, workspaceId, sectorRow.id);
  await upsertWorkspaceMembership(supabase, {
    workspace_id: workspaceId,
    user_id: authUser.id,
    role_id: supervisorRole.id,
  });
  await setChannelAssignment(supabase, workspaceId, authUser.id, channel.id, sectorRow.id);

  console.log('');
  console.log('Supervisor provisionado com sucesso.');
  console.log(`  workspace: ${ws.display_name} (${ws.slug})`);
  console.log(`  user_id:   ${authUser.id}`);
  console.log(`  username:  ${username}`);
  console.log(`  email:     ${email}`);
  console.log(`  phone:     ${phone}`);
  console.log(`  role:      supervisor`);
  console.log(`  setor:     ${sectorRow.name}`);
  console.log(`  fila WA:   ${channel.display_name || channel.id}`);
  console.log('');
  console.log(`  senha:     ${password}`);
  console.log('');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

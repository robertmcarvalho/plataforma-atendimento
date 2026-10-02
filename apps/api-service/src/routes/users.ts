import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import {
  formatNextOpenHuman,
  hasCanonicalBusinessHours,
  isOpen,
  nextOpenAt,
  normalizeBusinessHours,
  todayIntervalsForApi,
} from '../lib/businessHours';
import { writeAuditLog } from '../lib/auditLog';
import { sectorIdsFromJwt } from '../lib/jwtSectorIds';
import { buildSectorPairs, replaceUserSectors } from '../lib/userSectorsDb';
import { listMembershipRoles, replaceMembershipRoles } from '../lib/membershipRoles';
import { effectivePermissions, hasResourcePermission } from '../lib/permissions';
import { isAttendantLikeRole } from '../lib/roleAliases';
import { getWorkspaceMembership, hasPlatformAccess, listWorkspaceMemberships, requireWorkspace, upsertWorkspaceMembership, type JwtUser } from '../lib/workspaceContext';
import {
  buildInviteEmailHtml,
  sendTransactionalEmail,
  workspaceEmailChannelSendOpts,
} from '../lib/emailSender';
import { verifyUserPassword } from '../lib/authPassword';
import { setAuthUserPassword } from '../lib/authUserAdmin';
import { resolveWebAppLoginUrl } from '../lib/webAppUrl';
import {
  generateTemporaryPassword,
  generateUsername,
  humanizeProvisionAuthError,
  isDuplicateAuthEmailError,
  tryLinkLeaderProvisionToExistingUser,
} from '../lib/userProvision';
import { listWorkspaceChannels } from '../lib/workspaceChannels';
import {
  mergeNotificationPrefPatch,
  mergeNotificationPrefs,
  serializeNotificationPrefs,
  type NotificationPrefKey,
  NOTIFICATION_PREF_KEYS,
} from '../lib/notificationPreferences';

const channelAssignmentsSchema = z.object({
  channels: z.array(
    z.object({
      workspace_channel_id: z.string().uuid(),
      enabled: z.boolean(),
      // IDs de setor nesta tela vêm do webhook operacional e podem ser slugs
      // (ex.: "operacional"), não necessariamente UUIDs de public.sectors.
      sector_ids: z.array(z.string().min(1)).default([]),
    })
  ),
});

const resetPasswordSchema = z.object({
  password: z.string().min(6).optional(),
  generate: z.boolean().optional(),
});

function exposeTemporaryPasswordsInApiResponses() {
  return process.env.USER_TEMP_PASSWORD_RESPONSE_ENABLED === 'true' || process.env.NODE_ENV !== 'production';
}

function temporaryPasswordResponse(password: string) {
  return exposeTemporaryPasswordsInApiResponses() ? password : undefined;
}

const userRoleFieldsSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  password: z.string().min(6),
  phone: z.string().optional(),
  role_id: z.string().uuid().optional(),
  role_ids: z.array(z.string().uuid()).min(1).optional(),
  primary_role_id: z.string().uuid().optional(),
  sector_id: z.string().uuid().optional(),
  sector_ids: z.array(z.string().uuid()).optional(),
  primary_sector_id: z.string().uuid().optional(),
  leader_id: z.string().uuid().optional(),
  business_hours: z.record(z.unknown()).optional(),
});

const createUserSchema = userRoleFieldsSchema.refine((d) => Boolean(d.role_id || d.role_ids?.length), {
  message: 'Informe role_id ou role_ids',
  path: ['role_id'],
});

const updateUserSchema = userRoleFieldsSchema.partial().omit({ password: true, email: true });

const patchMeSchema = z
  .object({
    name: z.string().min(2).max(120).optional(),
    phone: z.preprocess(
      (v) => (v === '' ? null : v),
      z.union([z.string().max(40), z.null()]).optional()
    ),
    ui_preferences: z.record(z.unknown()).optional(),
  })
  .refine((d) => d.name !== undefined || d.phone !== undefined || d.ui_preferences !== undefined, {
    message: 'Envie pelo menos um campo para atualizar (nome, telefone ou preferências).',
  });

const patchMePasswordSchema = z
  .object({
    current_password: z.string().min(6),
    new_password: z.string().min(8),
  })
  .refine((d) => d.current_password !== d.new_password, {
    message: 'A nova senha deve ser diferente da senha atual.',
    path: ['new_password'],
  });

async function workspaceDisplayName(workspaceId: string): Promise<string> {
  const { data } = await supabase.from('workspaces').select('display_name').eq('id', workspaceId).maybeSingle();
  return String(data?.display_name || 'Flux Farma').trim() || 'Flux Farma';
}

const notificationPrefsPatchSchema = z
  .record(z.boolean())
  .superRefine((r, ctx) => {
    for (const k of Object.keys(r)) {
      if (!NOTIFICATION_PREF_KEYS.includes(k as NotificationPrefKey)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Chave de notificação desconhecida: ${k}` });
      }
    }
  });

async function resolveRoleName(workspaceId: string, roleId: string | undefined | null): Promise<string | null> {
  if (!roleId) return null;
  const { data, error } = await supabase.from('roles').select('name').eq('workspace_id', workspaceId).eq('id', roleId).single();
  if (error) throw new Error(error.message);
  return String(data?.name || '').trim().toLowerCase() || null;
}

async function syncLeaderProfileForUser(params: {
  workspaceId: string;
  userId: string;
  roleName: string | null;
  leaderId?: string | null;
  name: string;
  email?: string | null;
  phone?: string | null;
}) {
  if (params.roleName !== 'leader') return;

  const now = new Date().toISOString();
  const name = String(params.name || '').trim() || 'Líder sem nome';
  const email = params.email ? String(params.email).trim() : null;
  const phone = params.phone ? String(params.phone).trim() : '';

  if (params.leaderId) {
    const updates: Record<string, unknown> = {
      workspace_id: params.workspaceId,
      user_id: params.userId,
      name,
      email,
      updated_at: now,
    };
    if (phone) updates.phone = phone;

    const { error } = await supabase.from('leaders').update(updates).eq('workspace_id', params.workspaceId).eq('id', params.leaderId);
    if (error) throw new Error(error.message);
    return;
  }

  if (!phone) {
    throw new Error('Usuário líder precisa de telefone ou de um perfil de líder já vinculado.');
  }

  const payload = {
    workspace_id: params.workspaceId,
    name,
    phone,
    email,
    status: 'active',
    user_id: params.userId,
    updated_at: now,
  };

  const { error } = await supabase.from('leaders').upsert(payload, { onConflict: 'workspace_id,phone' });
  if (error) throw new Error(error.message);
}

async function listMembershipRowsForWorkspace(workspaceId: string) {
  const { data, error } = await supabase
    .from('workspace_memberships')
    .select('user_id, role_id, is_active, is_default, roles(name, permissions)')
    .eq('workspace_id', workspaceId);
  if (error) throw new Error(error.message);
  return (data || []) as Array<{
    user_id: string;
    role_id?: string | null;
    is_active?: boolean;
    is_default?: boolean;
    roles?: { name?: string; permissions?: Record<string, unknown> } | Array<{ name?: string; permissions?: Record<string, unknown> }> | null;
  }>;
}

type WorkspaceScopedUserRow = Record<string, unknown> & { id: string };

function operationalSectorLabelsFromChannels(channels: Awaited<ReturnType<typeof listWorkspaceChannels>>) {
  const labels = new Map<string, string>();
  for (const channel of channels.filter((c) => c.channel_type === 'whatsapp')) {
    const config = channel.config || {};
    const sectors = Array.isArray(config.sectors) ? config.sectors : [];
    for (const raw of sectors) {
      const sector = raw as Record<string, unknown>;
      const id = String(sector.id || '').trim();
      const name = String(sector.name || sector.label || id).trim();
      if (id && name) labels.set(id, name);
    }
    const queues = Array.isArray(config.queues) ? config.queues : [];
    for (const rawQueue of queues) {
      const queue = rawQueue as Record<string, unknown>;
      const sectorIds = Array.isArray(queue.sector_ids) ? queue.sector_ids.map((x) => String(x || '').trim()).filter(Boolean) : [];
      for (const sectorId of sectorIds) {
        if (!labels.has(sectorId)) labels.set(sectorId, sectorId);
      }
    }
  }
  return labels;
}

async function userOperationalSectorLabels(workspaceId: string, userIds: string[]) {
  const result = new Map<string, string[]>();
  if (!userIds.length) return result;

  const [channels, assignmentsRes] = await Promise.all([
    listWorkspaceChannels(workspaceId).catch(() => []),
    supabase
      .from('user_channel_queue_assignments')
      .select('user_id, queue_name, is_enabled')
      .eq('workspace_id', workspaceId)
      .eq('is_enabled', true)
      .in('user_id', userIds),
  ]);

  const labels = operationalSectorLabelsFromChannels(channels);
  for (const row of assignmentsRes.data || []) {
    const userId = String(row.user_id || '');
    const queueName = String(row.queue_name || '').trim();
    if (!userId || !queueName || queueName === 'default') continue;
    const label = labels.get(queueName) || queueName;
    const current = result.get(userId) || [];
    if (!current.includes(label)) current.push(label);
    result.set(userId, current);
  }
  return result;
}

async function enrichUsersWithWorkspaceRole(workspaceId: string, rows: Array<Record<string, unknown>>): Promise<WorkspaceScopedUserRow[]> {
  const memberships = await listMembershipRowsForWorkspace(workspaceId);
  const membershipByUser = new Map(
    memberships.map((row) => {
      const role = Array.isArray(row.roles) ? row.roles[0] : row.roles;
      return [
        row.user_id,
        {
          role_id: row.role_id || null,
          workspace_role: String(role?.name || 'attendant'),
          permissions: (role?.permissions as Record<string, unknown>) || {},
          is_active: row.is_active ?? true,
          is_default: row.is_default ?? false,
        },
      ];
    })
  );

  return rows
    .filter((row) => membershipByUser.has(String(row.id || '')))
    .map((row) => {
      const membership = membershipByUser.get(String(row.id || ''));
      return {
        ...row,
        id: String(row.id || ''),
        role_id: membership?.role_id ?? row.role_id ?? null,
        workspace_role: membership?.workspace_role || null,
        permissions: membership?.permissions || {},
        membership_is_active: membership?.is_active ?? true,
        membership_is_default: membership?.is_default ?? false,
      } satisfies WorkspaceScopedUserRow;
    });
}

export async function userRoutes(app: FastifyInstance) {
  // GET /api/users/attendants — id + nome para filas, transferência e vínculos (sem listagem completa)
  app.get('/attendants', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const jwtUser = request.user as JwtUser;
    const query = request.query as { include_supervisors?: string; scope?: string; sector_id?: string };
    const includeSupervisors = query.include_supervisors === '1' || query.include_supervisors === 'true';
    const scope = String(query.scope || 'sector').trim().toLowerCase();
    const filterSectorId = String(query.sector_id || '').trim();
    if (scope !== 'sector' && scope !== 'workspace') {
      return reply.status(400).send({ error: 'scope deve ser sector ou workspace' });
    }

    const { data, error } = await supabase
      .from('users')
      .select('id, name, sector_id, user_sectors(sector_id), roles(name)')
      .eq('is_active', true)
      .order('name');
    if (error) return reply.status(500).send({ error: error.message });

    type AttendantRow = Record<string, unknown> & {
      id?: string;
      name?: string;
      sector_id?: string | null;
      user_sectors?: { sector_id: string }[];
      workspace_role?: string | null;
      membership_is_active?: boolean;
    };

    let rows = (await enrichUsersWithWorkspaceRole(workspaceId, (data || []) as Array<Record<string, unknown>>)) as AttendantRow[];
    rows = rows.filter((row) => {
      if (row.membership_is_active === false) return false;
      const role = row.workspace_role;
      return (
        role === 'attendant' ||
        role === 'attendant_financeiro' ||
        role === 'financial' ||
        role === 'operational' ||
        (includeSupervisors && role === 'supervisor')
      );
    });

    const role = String(jwtUser.role || jwtUser.workspace_role || '').trim();
    const roleIsElevated = role === 'admin' || role === 'operational' || hasPlatformAccess(jwtUser);

    if (scope === 'workspace' && !roleIsElevated && role !== 'supervisor') {
      const perms = await effectivePermissions(jwtUser);
      if (!hasResourcePermission({ ...jwtUser, permissions: perms }, 'pharmacies', 'manage')) {
        return reply.status(403).send({ error: 'Acesso negado' });
      }
    }

    const skipSectorFilter = scope === 'workspace' || roleIsElevated;

    if (!skipSectorFilter && (role === 'supervisor' || isAttendantLikeRole(role))) {
      const jwtIds = sectorIdsFromJwt(jwtUser);
      if (jwtIds.length) {
        rows = rows.filter((row) => {
          const pairs = row.user_sectors || [];
          const rowIds = pairs.map((p) => p.sector_id).filter(Boolean);
          if (rowIds.length) return rowIds.some((id) => jwtIds.includes(id));
          return Boolean(row.sector_id && jwtIds.includes(row.sector_id));
        });
      } else if (jwtUser.sector_id) {
        rows = rows.filter((row) => row.sector_id === jwtUser.sector_id);
      }
    }

    if (filterSectorId) {
      rows = rows.filter((row) => {
        const pairs = row.user_sectors || [];
        const rowIds = pairs.map((p) => p.sector_id).filter(Boolean);
        if (rowIds.length) return rowIds.includes(filterSectorId);
        return row.sector_id === filterSectorId;
      });
    }

    return reply.send(
      rows.map((row) => {
        const pairs = row.user_sectors || [];
        const sectorIds = pairs.map((p) => p.sector_id).filter(Boolean);
        if (!sectorIds.length && row.sector_id) sectorIds.push(String(row.sector_id));
        return {
          id: String(row.id),
          name: String(row.name),
          role: String(row.workspace_role || 'attendant'),
          sector_ids: sectorIds,
        };
      }),
    );
  });

  // GET /api/users/mention-candidates — nomes para autocomplete @ em notas internas
  app.get('/mention-candidates', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const { data: memberships, error: memErr } = await supabase
      .from('workspace_memberships')
      .select('user_id')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true);
    if (memErr) return reply.status(500).send({ error: memErr.message });

    const userIds = (memberships || []).map((m) => m.user_id).filter(Boolean) as string[];
    if (!userIds.length) return reply.send([]);

    const { data, error } = await supabase
      .from('users')
      .select('id, name')
      .in('id', userIds)
      .eq('is_active', true)
      .order('name');
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send(
      (data || []).map((u) => ({
        id: String(u.id),
        name: String(u.name || '').trim(),
      }))
    );
  });

  app.patch('/me', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = patchMeSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return reply.status(400).send({
        error: first?.message || 'Dados inválidos',
        details: parsed.error.flatten(),
      });
    }

    const sub = (request.user as { sub: string }).sub;
    const { data: row, error: rowErr } = await supabase.from('users').select('id').eq('id', sub).single();
    if (rowErr || !row) return reply.status(404).send({ error: 'Usuário não encontrado' });

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.name !== undefined) updates.name = parsed.data.name;
    if (parsed.data.phone !== undefined) updates.phone = parsed.data.phone;
    if (parsed.data.ui_preferences !== undefined) {
      const { data: current, error: prefErr } = await supabase.from('users').select('ui_preferences').eq('id', sub).single();
      if (prefErr) {
        if ((prefErr.message || '').includes('ui_preferences')) {
          return reply.status(503).send({ error: 'Coluna ui_preferences não aplicada. Execute a migration 011.' });
        }
        return reply.status(500).send({ error: prefErr.message });
      }
      const prev = (current?.ui_preferences as Record<string, unknown> | null) || {};
      updates.ui_preferences = { ...prev, ...parsed.data.ui_preferences };
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', sub)
      .select('*, roles(name, permissions), sectors(name)')
      .single();
    if (error) {
      if ((error.message || '').includes('ui_preferences')) {
        return reply.status(503).send({ error: 'Coluna ui_preferences não aplicada. Execute a migration 011.' });
      }
      return reply.status(500).send({ error: error.message });
    }

    await writeAuditLog({
      actor_id: sub,
      action: 'user.patch_me',
      entity_type: 'user',
      entity_id: sub,
      metadata: { fields: Object.keys(parsed.data) },
    });

    return reply.send(data);
  });

  app.patch('/me/password', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = patchMePasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return reply.status(400).send({
        error: first?.message || 'Dados inválidos',
        details: parsed.error.flatten(),
      });
    }

    const sub = (request.user as { sub: string }).sub;
    const { data: row, error: rowErr } = await supabase
      .from('users')
      .select('id, email, is_active')
      .eq('id', sub)
      .single();
    if (rowErr || !row) return reply.status(404).send({ error: 'Usuário não encontrado' });
    if (row.is_active === false) return reply.status(403).send({ error: 'Conta inativa' });

    const email = String(row.email || '').trim();
    if (!email) return reply.status(400).send({ error: 'E-mail não configurado para este usuário.' });

    let passwordOk = false;
    try {
      passwordOk = await verifyUserPassword(email, parsed.data.current_password);
    } catch (e) {
      return reply.status(503).send({
        error: e instanceof Error ? e.message : 'Validação de senha indisponível.',
      });
    }
    if (!passwordOk) {
      return reply.status(400).send({ error: 'Senha atual incorreta.' });
    }

    try {
      await setAuthUserPassword(sub, parsed.data.new_password);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao atualizar senha no Auth';
      return reply.status(400).send({ error: msg });
    }

    const { error: updErr } = await supabase
      .from('users')
      .update({ must_change_password: false, updated_at: new Date().toISOString() })
      .eq('id', sub);
    if (updErr) return reply.status(500).send({ error: updErr.message });

    await writeAuditLog({
      actor_id: sub,
      action: 'user.password.change_self',
      entity_type: 'user',
      entity_id: sub,
      metadata: {},
    });

    return reply.send({ ok: true });
  });

  app.get('/me/inbox-notifications/state', { preHandler: [authenticate] }, async (request, reply) => {
    const sub = (request.user as { sub: string }).sub;
    const { data, error } = await supabase
      .from('users')
      .select('inbox_notifications_seen_at')
      .eq('id', sub)
      .maybeSingle();
    if (error) {
      if ((error.message || '').includes('inbox_notifications_seen_at')) {
        return reply.status(503).send({ error: 'Coluna inbox_notifications_seen_at não aplicada. Execute a migration 080.' });
      }
      return reply.status(500).send({ error: error.message });
    }
    const raw = data?.inbox_notifications_seen_at;
    return reply.send({
      seen_at: raw ? new Date(String(raw)).toISOString() : null,
    });
  });

  app.patch('/me/inbox-notifications/mark-all-read', { preHandler: [authenticate] }, async (request, reply) => {
    const sub = (request.user as { sub: string }).sub;
    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from('users')
      .update({ inbox_notifications_seen_at: now, updated_at: now })
      .eq('id', sub)
      .select('inbox_notifications_seen_at')
      .single();
    if (error) {
      if ((error.message || '').includes('inbox_notifications_seen_at')) {
        return reply.status(503).send({ error: 'Coluna inbox_notifications_seen_at não aplicada. Execute a migration 080.' });
      }
      return reply.status(500).send({ error: error.message });
    }
    await writeAuditLog({
      actor_id: sub,
      action: 'user.inbox_notifications.mark_all_read',
      entity_type: 'user',
      entity_id: sub,
      metadata: {},
    });
    return reply.send({
      seen_at: data.inbox_notifications_seen_at ? new Date(String(data.inbox_notifications_seen_at)).toISOString() : now,
    });
  });

  app.get('/me/notification-preferences', { preHandler: [authenticate] }, async (request, reply) => {
    const sub = (request.user as { sub: string }).sub;
    const { data, error } = await supabase.from('users').select('notification_preferences').eq('id', sub).single();
    if (error) return reply.status(404).send({ error: 'Usuário não encontrado' });
    const prefs = (data?.notification_preferences as Record<string, unknown> | null) || {};
    return reply.send(serializeNotificationPrefs(mergeNotificationPrefs(prefs)));
  });

  app.patch('/me/notification-preferences', { preHandler: [authenticate] }, async (request, reply) => {
    const parsed = notificationPrefsPatchSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const sub = (request.user as { sub: string }).sub;
    const { data: current, error: curErr } = await supabase.from('users').select('notification_preferences').eq('id', sub).single();
    if (curErr) return reply.status(404).send({ error: 'Usuário não encontrado' });

    const prev = (current?.notification_preferences as Record<string, unknown> | null) || {};
    const nextMerged = mergeNotificationPrefPatch(prev, parsed.data as Record<string, unknown>);
    const normalized = serializeNotificationPrefs(mergeNotificationPrefs(nextMerged));

    const { data, error } = await supabase
      .from('users')
      .update({ notification_preferences: normalized, updated_at: new Date().toISOString() })
      .eq('id', sub)
      .select('notification_preferences')
      .single();
    if (error) {
      if ((error.message || '').includes('notification_preferences')) {
        return reply.status(503).send({ error: 'Coluna notification_preferences não aplicada. Execute a migration 011.' });
      }
      return reply.status(500).send({ error: error.message });
    }

    await writeAuditLog({
      actor_id: sub,
      action: 'user.notification_preferences.patch',
      entity_type: 'user',
      entity_id: sub,
      metadata: { keys: Object.keys(parsed.data) },
    });

    return reply.send(
      serializeNotificationPrefs(mergeNotificationPrefs((data?.notification_preferences as Record<string, unknown> | null) || {}))
    );
  });

  const optionalUuid = z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    z.string().uuid().optional()
  );

  const provisionSchema = z.object({
    name: z.preprocess((v) => (typeof v === 'string' ? v.trim() : v), z.string().min(2)),
    email: z.preprocess((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v), z.string().email()),
    phone: z.preprocess(
      (v) => {
        if (v === '' || v === null || v === undefined) return undefined;
        return typeof v === 'string' ? v.trim() : v;
      },
      z.string().optional()
    ),
    role_id: z.string().uuid(),
    sector_id: optionalUuid,
    sector_ids: z.array(z.string().uuid()).optional(),
    primary_sector_id: optionalUuid,
    leader_id: optionalUuid,
    business_hours: z.record(z.unknown()).optional(),
    send_email: z.boolean().optional().default(true),
  });

  app.post('/provision', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = provisionSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    let roleName: string | null = null;
    try {
      roleName = await resolveRoleName(workspaceId, body.data.role_id);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Falha ao validar perfil' });
    }
    if (roleName === 'leader' && !body.data.leader_id && !String(body.data.phone || '').trim()) {
      return reply.status(400).send({ error: 'Usuário líder precisa de telefone ou perfil de líder vinculado.' });
    }

    const temporaryPassword = generateTemporaryPassword();
    let username = await generateUsername(workspaceId, body.data.name, body.data.email);
    const { sector_ids, primary_sector_id, send_email, ...userData } = body.data;
    const { pairs, primarySectorId } = buildSectorPairs({
      sector_ids,
      primary_sector_id,
      sector_id: userData.sector_id,
    });

    const { leader_id, business_hours, ...insertData } = userData;
    const bhPayload =
      business_hours !== undefined
        ? typeof business_hours === 'object' && business_hours !== null && Object.keys(business_hours).length === 0
          ? {}
          : normalizeBusinessHours(business_hours)
        : undefined;

    let authUserId: string;
    let data: Record<string, unknown>;

    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: userData.email,
      password: temporaryPassword,
      email_confirm: true,
    });

    if (authError) {
      if (roleName === 'leader' && leader_id && isDuplicateAuthEmailError(authError.message)) {
        const linked = await tryLinkLeaderProvisionToExistingUser({
          workspaceId,
          leaderId: leader_id,
          email: userData.email,
          name: userData.name,
          roleId: body.data.role_id,
          phone: userData.phone ?? null,
          temporaryPassword,
        });
        if (!linked.ok) return reply.status(400).send({ error: linked.error });
        authUserId = linked.userId;
        username = linked.username;
        data = linked.userRow;
      } else {
        return reply.status(400).send({ error: humanizeProvisionAuthError(authError.message) });
      }
    } else {
      authUserId = authUser.user.id;

      const { data: inserted, error } = await supabase
        .from('users')
        .insert({
          id: authUserId,
          ...insertData,
          username,
          must_change_password: true,
          provisioned_at: new Date().toISOString(),
          sector_id: primarySectorId ?? insertData.sector_id ?? null,
          ...(bhPayload !== undefined ? { business_hours: bhPayload } : {}),
        })
        .select('*, roles(name), sectors(name), user_sectors(sector_id, is_primary)')
        .single();
      if (error) return reply.status(500).send({ error: error.message });
      data = inserted as Record<string, unknown>;
    }

    try {
      await replaceUserSectors(supabase, authUserId, pairs, workspaceId);
      await upsertWorkspaceMembership({
        workspace_id: workspaceId,
        user_id: authUserId,
        role_id: body.data.role_id,
        is_active: true,
        is_default: true,
      });
      await syncLeaderProfileForUser({
        workspaceId,
        userId: authUserId,
        roleName,
        leaderId: leader_id,
        name: userData.name,
        email: userData.email,
        phone: userData.phone ?? null,
      });
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao finalizar provisionamento' });
    }

    let emailSent = false;
    if (send_email) {
      const loginUrl = resolveWebAppLoginUrl();
      const wsName = await workspaceDisplayName(workspaceId);
      const mail = buildInviteEmailHtml({
        name: userData.name,
        email: userData.email,
        username,
        temporaryPassword,
        loginUrl,
        workspaceName: wsName,
      });
      try {
        const channelOpts = await workspaceEmailChannelSendOpts(workspaceId);
        await sendTransactionalEmail({
          to: userData.email,
          subject: mail.subject,
          html: mail.html,
          text: mail.text,
          workspaceId,
          templateKey: 'user_invite',
          ...channelOpts,
        });
        emailSent = true;
      } catch (e) {
        return reply.status(201).send({
          user: data,
          username,
          temporary_password: temporaryPasswordResponse(temporaryPassword),
          email_sent: false,
          email_error: e instanceof Error ? e.message : 'Falha ao enviar e-mail',
        });
      }
    }

    await writeAuditLog({
      actor_id: (request.user as { sub: string }).sub,
      action: 'user.provision',
      entity_type: 'user',
      entity_id: authUserId,
      metadata: { workspace_id: workspaceId, email_sent: emailSent },
    });

    return reply.status(201).send({
      user: data,
      username,
      temporary_password: temporaryPasswordResponse(temporaryPassword),
      email_sent: emailSent,
    });
  });

  app.post('/:id/resend-invite', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data: user, error } = await supabase.from('users').select('id, name, email, username').eq('id', id).single();
    if (error || !user) return reply.status(404).send({ error: 'Usuário não encontrado' });

    const temporaryPassword = generateTemporaryPassword();
    const username = user.username || (await generateUsername(workspaceId, user.name, user.email));

    try {
      await setAuthUserPassword(id, temporaryPassword);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao atualizar senha no Auth';
      return reply.status(400).send({ error: msg });
    }

    await supabase
      .from('users')
      .update({ username, must_change_password: true, updated_at: new Date().toISOString() })
      .eq('id', id);

    const loginUrl = resolveWebAppLoginUrl();
    const wsName = await workspaceDisplayName(workspaceId);
    const mail = buildInviteEmailHtml({
      name: user.name,
      email: user.email,
      username,
      temporaryPassword,
      loginUrl,
      workspaceName: wsName,
    });
    const channelOpts = await workspaceEmailChannelSendOpts(workspaceId);
    try {
      await sendTransactionalEmail({
        to: user.email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        workspaceId,
        templateKey: 'user_invite_resend',
        ...channelOpts,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao enviar e-mail';
      return reply.status(502).send({
        error: msg,
        email_sent: false,
        note: 'Senha já foi atualizada no Auth; reenvie o convite ou comunique a senha manualmente.',
      });
    }

    await writeAuditLog({
      actor_id: (request.user as { sub: string }).sub,
      action: 'user.invite.resend',
      entity_type: 'user',
      entity_id: id,
      metadata: { workspace_id: workspaceId },
    });

    return reply.send({ ok: true, username, temporary_password: temporaryPasswordResponse(temporaryPassword) });
  });

  // GET /api/users/counts-by-role — KPIs da lista de usuários
  app.get('/counts-by-role', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase.from('users').select('id, roles(name)').order('name');
    if (error) return reply.status(500).send({ error: error.message });
    const scoped = await enrichUsersWithWorkspaceRole(workspaceId, (data || []) as Array<Record<string, unknown>>);
    const counts: Record<string, number> = {
      admin: 0,
      supervisor: 0,
      financial: 0,
      operational: 0,
      attendant: 0,
      leader: 0,
      commercial: 0,
      sales: 0,
    };
    for (const row of scoped) {
      const role = String((row as { workspace_role?: string }).workspace_role || '').toLowerCase();
      if (role in counts) counts[role] += 1;
    }
    return reply.send({ counts_by_role: counts, total: scoped.length });
  });

  // GET /api/users — listagem completa (administração)
  app.get('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('users')
      .select('*, roles(name), sectors(name), leaders(id, name), user_sectors(sector_id, is_primary, sectors(name))')
      .order('name');
    if (error) return reply.status(500).send({ error: error.message });
    const scoped = await enrichUsersWithWorkspaceRole(workspaceId, (data || []) as Array<Record<string, unknown>>);
    const userIds = scoped.map((u) => String(u.id)).filter(Boolean);
    const queueCountByUser = new Map<string, number>();
    const operationalSectorsByUser = await userOperationalSectorLabels(workspaceId, userIds);
    if (userIds.length) {
      const { data: assigns } = await supabase
        .from('user_channel_queue_assignments')
        .select('user_id')
        .eq('workspace_id', workspaceId)
        .eq('is_enabled', true)
        .in('user_id', userIds);
      for (const row of assigns || []) {
        const uid = String(row.user_id);
        queueCountByUser.set(uid, (queueCountByUser.get(uid) || 0) + 1);
      }
    }
    return reply.send(
      scoped.map((u) => ({
        ...u,
        whatsapp_queues_count: queueCountByUser.get(String(u.id)) || 0,
        operational_sector_labels: operationalSectorsByUser.get(String(u.id)) || [],
      }))
    );
  });

  // GET /api/users/:id/status — horário do atendente (para roteamento / UI)
  app.get('/:id/status', { preHandler: [authenticate] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const { data, error } = await supabase.from('users').select('business_hours').eq('id', id).maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });

    const cfg = normalizeBusinessHours(data?.business_hours ?? {});
    const now = new Date();
    const canonical = hasCanonicalBusinessHours(data?.business_hours);
    const open = !canonical || isOpen(cfg, now);
    const nextOpen = canonical && !open ? nextOpenAt(cfg, now) : null;

    return reply.send({
      is_open: open,
      next_open_at: nextOpen?.toISOString() ?? null,
      next_open_at_label: nextOpen ? formatNextOpenHuman(cfg, nextOpen) : null,
      today_intervals: todayIntervalsForApi(canonical ? cfg : null, now),
    });
  });

  // GET /api/users/:id/stats
  app.get('/:id/stats', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const since = new Date();
    since.setDate(since.getDate() - 30);

    const [convRes, userRes] = await Promise.all([
      supabase
        .from('conversations')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('attendant_id', id)
        .gte('created_at', since.toISOString()),
      supabase.from('users').select('last_login_at, provisioned_at, created_at').eq('id', id).maybeSingle(),
    ]);

    if (convRes.error) return reply.status(500).send({ error: convRes.error.message });

    const convIds = (convRes.data || []).map((c) => c.id).filter(Boolean);
    let outbound_messages = 0;
    if (convIds.length) {
      const { count, error: msgErr } = await supabase
        .from('messages')
        .select('id', { count: 'exact', head: true })
        .eq('direction', 'outbound')
        .in('conversation_id', convIds);
      if (msgErr) return reply.status(500).send({ error: msgErr.message });
      outbound_messages = count ?? 0;
    }

    return reply.send({
      period_days: 30,
      conversations_handled: convIds.length,
      outbound_messages,
      last_login_at: userRes.data?.last_login_at ?? null,
      provisioned_at: userRes.data?.provisioned_at ?? null,
      member_since: userRes.data?.created_at ?? null,
    });
  });

  // GET /api/users/:id/channel-assignments
  app.get('/:id/channel-assignments', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };

    const [assignmentsRes, channels] = await Promise.all([
      supabase
        .from('user_channel_queue_assignments')
        .select('workspace_channel_id, queue_name, is_enabled')
        .eq('workspace_id', workspaceId)
        .eq('user_id', id),
      listWorkspaceChannels(workspaceId).catch(() => []),
    ]);

    if (assignmentsRes.error) {
      if ((assignmentsRes.error.message || '').includes('user_channel_queue_assignments')) {
        return reply.send({ channels: channels.map((c) => ({ workspace_channel_id: c.id, display_name: c.display_name, channel_type: c.channel_type, enabled: false, sector_ids: [] as string[] })) });
      }
      return reply.status(500).send({ error: assignmentsRes.error.message });
    }

    const byChannel = new Map<string, { enabled: boolean; sector_ids: string[] }>();
    for (const row of assignmentsRes.data || []) {
      const chId = String(row.workspace_channel_id);
      const qn = String(row.queue_name || 'default');
      if (!row.is_enabled) continue;
      const cur = byChannel.get(chId) || { enabled: false, sector_ids: [] as string[] };
      cur.enabled = true;
      if (qn !== 'default') cur.sector_ids.push(qn);
      byChannel.set(chId, cur);
    }

    return reply.send({
      channels: channels.map((c) => {
        const a = byChannel.get(c.id);
        return {
          workspace_channel_id: c.id,
          display_name: c.display_name,
          channel_type: c.channel_type,
          enabled: Boolean(a?.enabled),
          sector_ids: a?.sector_ids || [],
        };
      }),
    });
  });

  // PUT /api/users/:id/channel-assignments
  app.put('/:id/channel-assignments', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = channelAssignmentsSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { error: delErr } = await supabase
      .from('user_channel_queue_assignments')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('user_id', id);
    if (delErr && !(delErr.message || '').includes('user_channel_queue_assignments')) {
      return reply.status(500).send({ error: delErr.message });
    }

    const rows: Array<Record<string, unknown>> = [];
    const now = new Date().toISOString();
    for (const ch of body.data.channels) {
      if (!ch.enabled) continue;
      const sectorIds = ch.sector_ids?.length ? ch.sector_ids : [];
      if (!sectorIds.length) {
        rows.push({
          workspace_id: workspaceId,
          user_id: id,
          workspace_channel_id: ch.workspace_channel_id,
          queue_name: 'default',
          is_enabled: true,
          updated_at: now,
        });
        continue;
      }
      for (const sectorId of sectorIds) {
        rows.push({
          workspace_id: workspaceId,
          user_id: id,
          workspace_channel_id: ch.workspace_channel_id,
          queue_name: sectorId,
          is_enabled: true,
          updated_at: now,
        });
      }
    }

    if (rows.length) {
      const { error: insErr } = await supabase.from('user_channel_queue_assignments').insert(rows.map((row) => ({ ...row, workspace_id: workspaceId })));
      if (insErr) return reply.status(500).send({ error: insErr.message });
    }

    const candidateSectorIds = [
      ...new Set(
        body.data.channels
          .filter((ch) => ch.enabled)
          .flatMap((ch) => (ch.sector_ids || []).map((sid) => String(sid).trim()))
          .filter((sid) => /^[0-9a-f-]{36}$/i.test(sid))
      ),
    ];
    const { data: validSectorRows } = candidateSectorIds.length
      ? await supabase.from('sectors').select('id').eq('workspace_id', workspaceId).in('id', candidateSectorIds)
      : { data: [] as { id: string }[] };
    const sectorIdsFromQueues = (validSectorRows || []).map((r) => String(r.id));
    if (sectorIdsFromQueues.length) {
      const { pairs, primarySectorId } = buildSectorPairs({
        sector_ids: sectorIdsFromQueues,
        primary_sector_id: sectorIdsFromQueues[0],
      });
      await replaceUserSectors(supabase, id, pairs, workspaceId);
      if (primarySectorId) {
        await supabase
          .from('users')
          .update({ sector_id: primarySectorId, updated_at: new Date().toISOString() })
          .eq('id', id);
      }
    }

    return reply.send({ ok: true, saved: rows.length });
  });

  // POST /api/users/:id/password — redefine senha (admin)
  app.post('/:id/password', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = resetPasswordSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { data: user, error } = await supabase.from('users').select('id, email').eq('id', id).single();
    if (error || !user) return reply.status(404).send({ error: 'Usuário não encontrado' });

    const password = body.data.generate !== false && !body.data.password ? generateTemporaryPassword() : body.data.password;
    if (!password) return reply.status(400).send({ error: 'Informe uma senha ou use generate: true' });

    try {
      await setAuthUserPassword(id, password);
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Falha ao atualizar senha no Auth';
      return reply.status(400).send({ error: msg });
    }

    await supabase
      .from('users')
      .update({ must_change_password: true, updated_at: new Date().toISOString() })
      .eq('id', id);

    await writeAuditLog({
      actor_id: (request.user as { sub: string }).sub,
      action: 'user.password.reset',
      entity_type: 'user',
      entity_id: id,
      metadata: { workspace_id: workspaceId, generated: !body.data.password },
    });

    return reply.send({ ok: true, temporary_password: body.data.password ? undefined : temporaryPasswordResponse(password) });
  });

  // DELETE /api/users/:id — desativação (soft delete)
  app.delete('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const actorId = (request.user as { sub: string }).sub;
    if (id === actorId) return reply.status(400).send({ error: 'Não é possível desativar o próprio usuário.' });

    const { data: current, error: curErr } = await supabase.from('users').select('is_active').eq('id', id).single();
    if (curErr || !current) return reply.status(404).send({ error: 'Usuário não encontrado' });

    const { error } = await supabase
      .from('users')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });

    await upsertWorkspaceMembership({
      workspace_id: workspaceId,
      user_id: id,
      role_id: (await supabase.from('workspace_memberships').select('role_id').eq('workspace_id', workspaceId).eq('user_id', id).maybeSingle())
        .data?.role_id ?? null,
      is_active: false,
      is_default: true,
    });

    await writeAuditLog({
      actor_id: actorId,
      action: 'user.soft_delete',
      entity_type: 'user',
      entity_id: id,
      metadata: { workspace_id: workspaceId },
    });

    return reply.send({ ok: true, is_active: false });
  });

  // GET /api/users/:id
  app.get('/:id', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('users')
      .select('*, roles(name, permissions), sectors(name), leaders(id, name), user_sectors(sector_id, is_primary, sectors(name))')
      .eq('id', id)
      .single();
    if (error) return reply.status(404).send({ error: 'Usuário não encontrado' });
    const membership = await getWorkspaceMembership(workspaceId, id);
    const membershipRoles = await listMembershipRoles(supabase, workspaceId, id);
    const operationalSectors = await userOperationalSectorLabels(workspaceId, [id]);
    return reply.send({
      ...data,
      workspace_role: membership?.workspace_role || null,
      workspace_roles: membershipRoles.map((r) => r.role_name),
      membership_roles: membershipRoles.map((r) => ({
        role_id: r.role_id,
        is_primary: r.is_primary,
        name: r.role_name,
      })),
      permissions: membership?.permissions || {},
      operational_sector_labels: operationalSectors.get(id) || [],
      workspace_id: workspaceId,
    });
  });

  // POST /api/users
  app.post('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = createUserSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const effectiveRoleIds = body.data.role_ids?.length
      ? body.data.role_ids
      : body.data.role_id
        ? [body.data.role_id]
        : [];
    const primaryRoleId = body.data.primary_role_id || effectiveRoleIds[0];
    if (!effectiveRoleIds.length || !primaryRoleId) {
      return reply.status(400).send({ error: 'Informe ao menos um papel.' });
    }

    let roleName: string | null = null;
    try {
      roleName = await resolveRoleName(workspaceId, primaryRoleId);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Falha ao validar perfil do usuário' });
    }
    if (roleName === 'leader' && !body.data.leader_id && !String(body.data.phone || '').trim()) {
      return reply.status(400).send({ error: 'Usuário líder precisa de telefone ou de um perfil de líder vinculado.' });
    }

    const { password, sector_ids, primary_sector_id, role_ids, primary_role_id, ...userData } = body.data;
    const { pairs, primarySectorId } = buildSectorPairs({
      sector_ids,
      primary_sector_id,
      sector_id: userData.sector_id,
    });

    // Cria usuário no Supabase Auth
    const { data: authUser, error: authError } = await supabase.auth.admin.createUser({
      email: userData.email,
      password,
      email_confirm: true,
    });
    if (authError) return reply.status(400).send({ error: authError.message });

    // Insere na tabela users (mesmo UUID do auth)
    const { leader_id, business_hours, ...insertData } = userData;
    const bhPayload =
      business_hours !== undefined
        ? typeof business_hours === 'object' &&
          business_hours !== null &&
          Object.keys(business_hours as object).length === 0
          ? {}
          : normalizeBusinessHours(business_hours)
        : undefined;
    const { data, error } = await supabase
      .from('users')
      .insert({
        id: authUser.user.id,
        ...insertData,
        role_id: primaryRoleId,
        sector_id: primarySectorId ?? insertData.sector_id ?? null,
        ...(bhPayload !== undefined ? { business_hours: bhPayload } : {}),
      })
      .select('*, roles(name), sectors(name), user_sectors(sector_id, is_primary)')
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    try {
      await replaceUserSectors(supabase, authUser.user.id, pairs, workspaceId);
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao salvar setores do usuário' });
    }

    try {
      await upsertWorkspaceMembership({
        workspace_id: workspaceId,
        user_id: authUser.user.id,
        role_id: primaryRoleId,
        is_active: true,
        is_default: true,
      });
      await replaceMembershipRoles(supabase, workspaceId, authUser.user.id, effectiveRoleIds, primaryRoleId);
      await syncLeaderProfileForUser({
        workspaceId,
        userId: authUser.user.id,
        roleName,
        leaderId: leader_id,
        name: userData.name,
        email: userData.email,
        phone: userData.phone ?? null,
      });
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao sincronizar perfil de líder' });
    }

    return reply.status(201).send(data);
  });

  // PUT /api/users/:id
  app.put('/:id', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = updateUserSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { data: currentUser, error: currentUserError } = await supabase
      .from('users')
      .select('role_id, phone, email, name, sector_id')
      .eq('id', id)
      .single();
    if (currentUserError || !currentUser) return reply.status(404).send({ error: 'Usuário não encontrado' });

    const { leader_id, business_hours, sector_ids, primary_sector_id, role_ids, primary_role_id, ...updateData } = body.data;
    const roleIdsTouched = role_ids !== undefined || updateData.role_id !== undefined || primary_role_id !== undefined;
    const effectiveRoleIds = role_ids?.length
      ? role_ids
      : updateData.role_id
        ? [updateData.role_id]
        : null;
    const effectiveRoleId =
      primary_role_id || effectiveRoleIds?.[0] || updateData.role_id || currentUser.role_id || null;
    let roleName: string | null = null;
    try {
      roleName = await resolveRoleName(workspaceId, effectiveRoleId);
    } catch (error) {
      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Falha ao validar perfil do usuário' });
    }
    const effectivePhone = updateData.phone ?? currentUser.phone ?? null;
    if (roleName === 'leader' && !leader_id && !String(effectivePhone || '').trim()) {
      return reply.status(400).send({ error: 'Usuário líder precisa de telefone ou de um perfil de líder vinculado.' });
    }

    const updates: Record<string, unknown> = { ...updateData, updated_at: new Date().toISOString() };

    const sectorTouched =
      sector_ids !== undefined || primary_sector_id !== undefined || updateData.sector_id !== undefined;
    let pairsToSave: ReturnType<typeof buildSectorPairs>['pairs'] | null = null;
    if (sectorTouched) {
      let idsForPairs = sector_ids;
      if (idsForPairs === undefined) {
        const { data: existingLinks } = await supabase.from('user_sectors').select('sector_id').eq('workspace_id', workspaceId).eq('user_id', id);
        idsForPairs = (existingLinks || []).map((r) => r.sector_id).filter(Boolean);
        if (!idsForPairs.length && currentUser?.sector_id) idsForPairs = [currentUser.sector_id];
      }
      const built = buildSectorPairs({
        sector_ids: idsForPairs,
        primary_sector_id,
        sector_id: updateData.sector_id ?? currentUser?.sector_id ?? null,
      });
      pairsToSave = built.pairs;
      updates.sector_id = built.primarySectorId ?? null;
    }
    if (business_hours !== undefined) {
      updates.business_hours =
        typeof business_hours === 'object' &&
        business_hours !== null &&
        Object.keys(business_hours as object).length === 0
          ? {}
          : normalizeBusinessHours(business_hours);
    }
    if (roleIdsTouched && effectiveRoleId) {
      updates.role_id = effectiveRoleId;
    }

    const { data, error } = await supabase
      .from('users')
      .update(updates)
      .eq('id', id)
      .select('*, roles(name), sectors(name), user_sectors(sector_id, is_primary)')
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    if (pairsToSave) {
      try {
        await replaceUserSectors(supabase, id, pairsToSave, workspaceId);
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao salvar setores do usuário' });
      }
    }

    if (roleIdsTouched && effectiveRoleIds?.length) {
      try {
        await replaceMembershipRoles(supabase, workspaceId, id, effectiveRoleIds, effectiveRoleId);
      } catch (e) {
        return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao salvar papéis do usuário' });
      }
    }

    try {
      await upsertWorkspaceMembership({
        workspace_id: workspaceId,
        user_id: id,
        role_id: effectiveRoleId,
        is_active: true,
        is_default: true,
      });
      await syncLeaderProfileForUser({
        workspaceId,
        userId: id,
        roleName,
        leaderId: leader_id,
        name: String(updateData.name ?? currentUser.name ?? ''),
        email: currentUser.email ?? '',
        phone: String(updateData.phone ?? currentUser.phone ?? ''),
      });
    } catch (e) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Falha ao sincronizar perfil de líder' });
    }

    // Atualiza vínculo com líder
    if (leader_id !== undefined) {
      // Remove vínculos anteriores deste usuário
      await supabase.from('leaders').update({ user_id: null }).eq('workspace_id', workspaceId).eq('user_id', id);
      // Se informou um novo líder, vincula
      if (leader_id) {
        await supabase.from('leaders').update({ user_id: id }).eq('workspace_id', workspaceId).eq('id', leader_id);
      }
    }

    const actorId = (request.user as { sub: string }).sub;
    const auditMeta: Record<string, unknown> = { workspace_id: workspaceId };
    if (roleIdsTouched && effectiveRoleIds?.length) {
      auditMeta.role_ids = effectiveRoleIds;
      auditMeta.primary_role_id = effectiveRoleId;
      if (effectiveRoleId !== currentUser.role_id) {
        auditMeta.role_id_from = currentUser.role_id;
        auditMeta.role_id_to = effectiveRoleId;
      }
    } else if (updateData.role_id && updateData.role_id !== currentUser.role_id) {
      auditMeta.role_id_from = currentUser.role_id;
      auditMeta.role_id_to = updateData.role_id;
    }
    if (sectorTouched) {
      auditMeta.sectors_updated = true;
      auditMeta.primary_sector_id = updates.sector_id ?? null;
    }
    if (auditMeta.role_id_from || auditMeta.role_ids || auditMeta.sectors_updated) {
      await writeAuditLog({
        actor_id: actorId,
        action: auditMeta.role_id_from || auditMeta.role_ids ? 'user.role_or_sectors.update' : 'user.sectors.update',
        entity_type: 'user',
        entity_id: id,
        workspace_id: workspaceId,
        metadata: auditMeta,
      });
    }

    const membershipRoles = await listMembershipRoles(supabase, workspaceId, id);
    return reply.send({
      ...data,
      workspace_role: membershipRoles.find((r) => r.is_primary)?.role_name || roleName,
      workspace_roles: membershipRoles.map((r) => r.role_name),
      membership_roles: membershipRoles.map((r) => ({
        role_id: r.role_id,
        is_primary: r.is_primary,
        name: r.role_name,
      })),
    });
  });

  // PATCH /api/users/:id/toggle
  app.patch('/:id/toggle', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data: current } = await supabase.from('users').select('is_active').eq('id', id).single();
    const { data, error } = await supabase
      .from('users')
      .update({ is_active: !current?.is_active, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    await upsertWorkspaceMembership({
      workspace_id: workspaceId,
      user_id: id,
      role_id: (await supabase.from('workspace_memberships').select('role_id').eq('workspace_id', workspaceId).eq('user_id', id).maybeSingle())
        .data?.role_id ?? null,
      is_active: !current?.is_active,
      is_default: true,
    });
    return reply.send(data);
  });
}

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { verifyUserPassword } from '../lib/authPassword';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { listSectorIdsForUser, resolveSectorIdsFromQueueAssignments } from '../lib/userSectorsDb';
import { getDefaultWorkspace, listWorkspaceMemberships, resolveActiveMembership } from '../lib/workspaceContext';
import { resolveAuthRolesForUser } from '../lib/membershipRoles';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
});

const switchWorkspaceSchema = z.object({
  workspace_id: z.string().uuid(),
});

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/login
  app.post('/login', async (request, reply) => {
    const body = loginSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { email, password } = body.data;

    // Busca usuário com role
    const { data: user, error } = await supabase
      .from('users')
      .select('*, roles(name, permissions)')
      .eq('email', email)
      .eq('is_active', true)
      .single();

    if (error || !user) return reply.status(401).send({ error: 'Credenciais inválidas' });

    // Valida senha sem manter sessão Auth no cliente Supabase compartilhado (evita RLS "self only" nas queries seguintes).
    const passwordOk = await verifyUserPassword(email, password);
    if (!passwordOk) return reply.status(401).send({ error: 'Credenciais inválidas' });

    const memberships = await listWorkspaceMemberships(String(user.id)).catch(() => []);
    const defaultWorkspace = await getDefaultWorkspace().catch(() => null);
    const activeMembership =
      resolveActiveMembership(
        {
          memberships,
          workspace_id: memberships.find((item) => item.is_default)?.workspace_id || memberships[0]?.workspace_id || null,
        },
        null
      ) ||
      (defaultWorkspace
        ? {
            workspace_id: defaultWorkspace.id,
            workspace_slug: defaultWorkspace.slug,
            workspace_name: defaultWorkspace.display_name,
            workspace_role: user.roles?.name || 'attendant',
            is_default: true,
            permissions: (user.roles?.permissions as Record<string, unknown>) || {},
          }
        : null);

    const resolvedRole = activeMembership?.workspace_role || user.roles?.name || 'attendant';
    const activeWs = activeMembership?.workspace_id || null;
    const authRoles = activeWs
      ? await resolveAuthRolesForUser(supabase, activeWs, user.id, user.role_id)
      : {
          primaryRoleName: String(resolvedRole).toLowerCase(),
          primaryRoleId: user.role_id ? String(user.role_id) : null,
          roleNames: [String(resolvedRole).toLowerCase()],
          roleIds: user.role_id ? [String(user.role_id)] : [],
          permissions: (user.roles?.permissions as Record<string, unknown>) || {},
          rows: [],
        };
    const resolvedPermissions = authRoles.permissions;

    let sector_ids: string[] = [];
    try {
      sector_ids = await listSectorIdsForUser(supabase, user.id, activeWs);
    } catch {
      sector_ids = [];
    }
    if (!sector_ids.length && activeWs) {
      try {
        sector_ids = await resolveSectorIdsFromQueueAssignments(supabase, activeWs, user.id);
      } catch {
        sector_ids = [];
      }
    }
    if (!sector_ids.length && user.sector_id) sector_ids = [user.sector_id];

    const token = app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: authRoles.primaryRoleName,
        workspace_role: authRoles.primaryRoleName,
        workspace_roles: authRoles.roleNames,
        platform_role: user.platform_role || 'member',
        workspace_id: activeMembership?.workspace_id || null,
        active_workspace_id: activeMembership?.workspace_id || null,
        active_workspace_name: activeMembership?.workspace_name || null,
        sector_id: user.sector_id,
        sector_ids,
        permissions: resolvedPermissions,
        memberships,
      },
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return reply.send({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: authRoles.primaryRoleName,
        workspace_role: authRoles.primaryRoleName,
        workspace_roles: authRoles.roleNames,
        platform_role: user.platform_role || 'member',
        workspace_id: activeMembership?.workspace_id || null,
        active_workspace_id: activeMembership?.workspace_id || null,
        active_workspace_name: activeMembership?.workspace_name || null,
        sector_id: user.sector_id,
        sector_ids,
        permissions: resolvedPermissions,
        workspace_memberships: memberships.length ? memberships : activeMembership ? [activeMembership] : [],
        memberships: memberships.length ? memberships : activeMembership ? [activeMembership] : [],
      },
    });
  });

  // GET /api/auth/mfa-policy — política de produto (sem expor MFA na UI até alinhamento com Supabase)
  app.get('/mfa-policy', { preHandler: authenticate }, async (_request, reply) => {
    return reply.send({
      enrollment_in_app: false,
      summary:
        '2FA (MFA) não é ativado nesta UI por política de produto: use o fluxo oficial do Supabase Auth ou o painel do projeto para TOTP/SMS, e exija novo login após alteração de roles.',
      docs: [
        'https://supabase.com/docs/guides/auth/auth-mfa',
        'https://supabase.com/docs/guides/auth/auth-mfa/phone',
      ],
      roles_editing: {
        json_editor_enabled: process.env.DISABLE_ROLE_JSON_EDITOR !== 'true',
        note:
          'Edição de permissions em JSON é apenas para administradores e fica registada em auditoria. Desative com DISABLE_ROLE_JSON_EDITOR=true no api-service.',
      },
    });
  });

  // GET /api/auth/me
  app.get('/me', { preHandler: authenticate }, async (request, reply) => {
    const payload = request.user as { sub: string; workspace_id?: string | null };
    const memberships = await listWorkspaceMemberships(payload.sub).catch(() => []);
    const { data: user } = await supabase
      .from('users')
      .select('*, roles(name, permissions), sectors(name), user_sectors(sector_id, is_primary)')
      .eq('id', payload.sub)
      .single();
    const activeMembership = resolveActiveMembership(
      {
        workspace_id: payload.workspace_id || null,
        memberships,
      },
      payload.workspace_id || null
    );
    const defaultWorkspace = activeMembership ? null : await getDefaultWorkspace().catch(() => null);
    const effectiveActiveMembership =
      activeMembership ||
      (defaultWorkspace
        ? {
            workspace_id: defaultWorkspace.id,
            workspace_slug: defaultWorkspace.slug,
            workspace_name: defaultWorkspace.display_name,
            workspace_role: ((user?.roles as { name?: string } | null)?.name as string | undefined) || 'attendant',
            is_default: true,
            permissions: ((user?.roles as { permissions?: Record<string, unknown> } | null)?.permissions as Record<string, unknown>) || {},
          }
        : null);
    const effectiveMemberships = memberships.length ? memberships : effectiveActiveMembership ? [effectiveActiveMembership] : [];
    const activeWs = effectiveActiveMembership?.workspace_id || payload.workspace_id || null;
    const authRoles = activeWs
      ? await resolveAuthRolesForUser(supabase, activeWs, payload.sub, user?.role_id ? String(user.role_id) : null)
      : null;
    return reply.send({
      ...user,
      active_workspace_id: effectiveActiveMembership?.workspace_id || null,
      active_workspace_name: effectiveActiveMembership?.workspace_name || null,
      workspace_memberships: effectiveMemberships,
      workspace_role: authRoles?.primaryRoleName || effectiveActiveMembership?.workspace_role || null,
      workspace_roles: authRoles?.roleNames || (effectiveActiveMembership?.workspace_role ? [effectiveActiveMembership.workspace_role] : []),
      platform_role: user?.platform_role || 'member',
      effective_permissions:
        authRoles?.permissions ||
        effectiveActiveMembership?.permissions ||
        ((user?.roles as { permissions?: Record<string, unknown> } | null)?.permissions ?? {}),
    });
  });

  // POST /api/auth/switch-workspace — troca o workspace ativo da sessão
  app.post('/switch-workspace', { preHandler: authenticate }, async (request, reply) => {
    const body = switchWorkspaceSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const jwtUser = request.user as {
      sub: string;
      email?: string;
      name?: string;
      platform_role?: string;
      sector_id?: string | null;
      sector_ids?: string[];
      memberships?: Awaited<ReturnType<typeof listWorkspaceMemberships>>;
    };

    const memberships = jwtUser.memberships?.length
      ? jwtUser.memberships
      : await listWorkspaceMemberships(jwtUser.sub);
    const target = memberships.find((item) => item.workspace_id === body.data.workspace_id);
    if (!target && !['platform_admin', 'platform_owner'].includes(String(jwtUser.platform_role || ''))) {
      return reply.status(403).send({ error: 'Sem acesso a este workspace' });
    }

    const { data: user } = await supabase
      .from('users')
      .select('id, name, email, platform_role, sector_id')
      .eq('id', jwtUser.sub)
      .single();

    let sector_ids: string[] = jwtUser.sector_ids || [];
    try {
      sector_ids = await listSectorIdsForUser(supabase, jwtUser.sub, body.data.workspace_id);
    } catch {
      sector_ids = [];
    }
    if (!sector_ids.length) {
      try {
        sector_ids = await resolveSectorIdsFromQueueAssignments(supabase, body.data.workspace_id, jwtUser.sub);
      } catch {
        sector_ids = [];
      }
    }
    if (!sector_ids.length && user?.sector_id) sector_ids = [user.sector_id];

    const workspaceRole = target?.workspace_role || 'attendant';
    const authRoles = await resolveAuthRolesForUser(supabase, body.data.workspace_id, jwtUser.sub);
    const permissions = authRoles.permissions;

    const token = app.jwt.sign(
      {
        sub: jwtUser.sub,
        email: user?.email || jwtUser.email,
        name: user?.name || jwtUser.name,
        role: authRoles.primaryRoleName,
        workspace_role: authRoles.primaryRoleName,
        workspace_roles: authRoles.roleNames,
        platform_role: user?.platform_role || jwtUser.platform_role || 'member',
        workspace_id: body.data.workspace_id,
        active_workspace_id: body.data.workspace_id,
        active_workspace_name: target?.workspace_name || null,
        sector_id: user?.sector_id || null,
        sector_ids,
        permissions,
        memberships,
      },
      { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
    );

    return reply.send({
      token,
      user: {
        id: jwtUser.sub,
        name: user?.name,
        email: user?.email,
        role: authRoles.primaryRoleName,
        workspace_role: authRoles.primaryRoleName,
        workspace_roles: authRoles.roleNames,
        platform_role: user?.platform_role || jwtUser.platform_role || 'member',
        workspace_id: body.data.workspace_id,
        active_workspace_id: body.data.workspace_id,
        sector_id: user?.sector_id || null,
        sector_ids,
        permissions,
        workspace_memberships: memberships,
        memberships,
      },
    });
  });

  // POST /api/auth/logout
  app.post('/logout', { preHandler: authenticate }, async (_request, reply) => {
    return reply.send({ message: 'Logout realizado' });
  });
}

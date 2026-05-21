import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { listSectorIdsForUser } from '../lib/userSectorsDb';
import { getDefaultWorkspace, listWorkspaceMemberships, resolveActiveMembership } from '../lib/workspaceContext';

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

    // Verifica senha (armazenada no Supabase Auth ou campo proprio)
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({ email, password });
    if (authError || !authData.user) return reply.status(401).send({ error: 'Credenciais inválidas' });

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
    const resolvedPermissions = activeMembership?.permissions || user.roles?.permissions || {};

    let sector_ids: string[] = [];
    try {
      sector_ids = await listSectorIdsForUser(supabase, user.id);
    } catch {
      sector_ids = [];
    }
    if (!sector_ids.length && user.sector_id) sector_ids = [user.sector_id];

    const token = app.jwt.sign(
      {
        sub: user.id,
        email: user.email,
        name: user.name,
        role: resolvedRole,
        workspace_role: resolvedRole,
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
        role: resolvedRole,
        workspace_role: resolvedRole,
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
    return reply.send({
      ...user,
      active_workspace_id: effectiveActiveMembership?.workspace_id || null,
      active_workspace_name: effectiveActiveMembership?.workspace_name || null,
      workspace_memberships: effectiveMemberships,
      workspace_role: effectiveActiveMembership?.workspace_role || null,
      platform_role: user?.platform_role || 'member',
      effective_permissions:
        effectiveActiveMembership?.permissions || ((user?.roles as { permissions?: Record<string, unknown> } | null)?.permissions ?? {}),
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
    if (!sector_ids.length && user?.sector_id) sector_ids = [user.sector_id];

    const workspaceRole = target?.workspace_role || 'attendant';
    const permissions = target?.permissions || {};

    const token = app.jwt.sign(
      {
        sub: jwtUser.sub,
        email: user?.email || jwtUser.email,
        name: user?.name || jwtUser.name,
        role: workspaceRole,
        workspace_role: workspaceRole,
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
        role: workspaceRole,
        workspace_role: workspaceRole,
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

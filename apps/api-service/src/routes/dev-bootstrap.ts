import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { normalizeBrazilPhone } from '../lib/excelCadastroImport';

const bootstrapLeaderSchema = z.object({
  email: z.string().email().default('leader.teste@aethera.local'),
  password: z.string().min(6).default('123456'),
  name: z.string().min(2).default('Líder Teste'),
  phone: z.string().min(10).optional().default('+5511999999999'),
});

function headerValue(value: string | string[] | undefined) {
  if (!value) return null;
  if (Array.isArray(value)) return value[0] || null;
  return value;
}

async function findAuthUserIdByEmail(email: string): Promise<string | null> {
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

export async function devBootstrapRoutes(app: FastifyInstance) {
  // POST /api/dev/bootstrap-leader
  app.post('/bootstrap-leader', async (request, reply) => {
    if (process.env.NODE_ENV === 'production') return reply.status(404).send({ error: 'Not found' });

    const token = process.env.DEV_BOOTSTRAP_TOKEN;
    if (token) {
      const got =
        headerValue(request.headers['x-dev-bootstrap-token']) ||
        headerValue(request.headers['x-dev-token']) ||
        headerValue(request.headers['authorization']);
      if (got !== token) return reply.status(403).send({ error: 'Forbidden' });
    }

    const parsed = bootstrapLeaderSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    }

    const { email, password, name, phone } = parsed.data;
    const phoneNorm = normalizeBrazilPhone(String(phone || ''));

    const { data: role, error: roleErr } = await supabase.from('roles').select('id').eq('name', 'leader').single();
    if (roleErr || !role?.id) {
      return reply.status(500).send({ error: 'Role "leader" não encontrada na tabela roles' });
    }

    // 1) Supabase Auth user
    let authUserId: string | null = null;
    const created = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (created.error) {
      // Se já existe, usa listUsers() para buscar por e-mail (compatível com supabase-js v2).
      const msg = created.error.message || 'Falha ao criar usuário no Supabase Auth';
      try {
        authUserId = await findAuthUserIdByEmail(email);
      } catch (e) {
        return reply.status(400).send({ error: msg, details: e instanceof Error ? e.message : String(e) });
      }
      if (!authUserId) return reply.status(400).send({ error: msg });

      // Garante login imediato com a senha fornecida.
      await supabase.auth.admin.updateUserById(authUserId, {
        password,
        email_confirm: true,
        user_metadata: { name },
      });
    } else {
      authUserId = created.data.user?.id || null;
    }

    if (!authUserId) return reply.status(500).send({ error: 'Não foi possível obter o id do usuário Auth' });

    // 2) users row (app table)
    const upsertUser = await supabase
      .from('users')
      .upsert(
        {
          id: authUserId,
          name,
          email,
          phone: phoneNorm || phone,
          role_id: role.id,
          is_active: true,
          sector_id: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      )
      .select('id')
      .single();

    if (upsertUser.error) return reply.status(500).send({ error: upsertUser.error.message });

    // 3) leaders profile row (leader-portal depende de leaders.user_id)
    const currentLeader = await supabase.from('leaders').select('id').eq('user_id', authUserId).maybeSingle();
    let leaderId = currentLeader.data?.id as string | undefined;
    if (currentLeader.error) return reply.status(500).send({ error: currentLeader.error.message });

    if (!leaderId) {
      const inserted = await supabase
        .from('leaders')
        .insert({
          name,
          phone: phoneNorm || phone,
          email,
          status: 'active',
          user_id: authUserId,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .select('id')
        .single();
      if (inserted.error) return reply.status(500).send({ error: inserted.error.message });
      leaderId = inserted.data?.id;
    }

    return reply.send({
      ok: true,
      credentials: { email, password },
      user_id: authUserId,
      leader_id: leaderId,
      note: 'Use /login para entrar. Se DEV_BOOTSTRAP_TOKEN estiver setado, envie o header x-dev-bootstrap-token.',
    });
  });
}

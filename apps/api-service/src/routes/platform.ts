import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate } from '../middleware/authenticate';
import { hasPlatformAccess, type JwtUser } from '../lib/workspaceContext';
import { writeAuditLog } from '../lib/auditLog';
import { getSystemEmailConfig, saveSystemEmailConfig, type SystemEmailConfig } from '../lib/platformSettings';

const createWorkspaceSchema = z.object({
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/),
  display_name: z.string().min(2),
  timezone: z.string().min(2).default('America/Sao_Paulo'),
});

export async function platformRoutes(app: FastifyInstance) {
  app.get('/workspaces', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtUser;
    if (!hasPlatformAccess(user)) return reply.status(403).send({ error: 'Acesso restrito à plataforma' });

    const { data, error } = await supabase
      .from('workspaces')
      .select('id, slug, display_name, timezone, is_active, created_at, updated_at')
      .order('display_name');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data || []);
  });

  app.post('/workspaces', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtUser;
    if (!hasPlatformAccess(user)) return reply.status(403).send({ error: 'Acesso restrito à plataforma' });

    const body = createWorkspaceSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const { data, error } = await supabase
      .from('workspaces')
      .insert({ ...body.data, is_active: true })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });

    await writeAuditLog({
      actor_id: String(user.sub || ''),
      action: 'platform.workspace.create',
      entity_type: 'workspace',
      entity_id: String(data.id),
      metadata: { slug: data.slug, display_name: data.display_name },
    });

    return reply.status(201).send(data);
  });

  app.get('/settings/system-email', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtUser;
    if (!hasPlatformAccess(user)) return reply.status(403).send({ error: 'Acesso restrito à plataforma' });
    const cfg = await getSystemEmailConfig();
    if (!cfg) return reply.send({ configured: false });
    return reply.send({
      configured: true,
      provider: cfg.provider,
      from_email: cfg.from_email,
      from_name: cfg.from_name,
      smtp_host: cfg.smtp_host,
      smtp_port: cfg.smtp_port,
      smtp_user: cfg.smtp_user,
      smtp_secure: cfg.smtp_secure,
    });
  });

  app.put('/settings/system-email', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtUser;
    if (!hasPlatformAccess(user)) return reply.status(403).send({ error: 'Acesso restrito à plataforma' });
    const body = z
      .object({
        provider: z.enum(['smtp', 'resend', 'sendgrid']),
        from_email: z.string().email(),
        from_name: z.string().optional(),
        smtp_host: z.string().optional(),
        smtp_port: z.number().int().optional(),
        smtp_user: z.string().optional(),
        smtp_pass: z.string().optional(),
        smtp_secure: z.boolean().optional(),
        api_key: z.string().optional(),
      })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });

    const current = await getSystemEmailConfig();
    const next: SystemEmailConfig = {
      provider: body.data.provider,
      from_email: body.data.from_email,
      from_name: body.data.from_name,
      smtp_host: body.data.smtp_host,
      smtp_port: body.data.smtp_port,
      smtp_user: body.data.smtp_user,
      smtp_pass: body.data.smtp_pass || current?.smtp_pass,
      smtp_secure: body.data.smtp_secure,
      api_key: body.data.api_key || current?.api_key,
    };
    await saveSystemEmailConfig(next);
    return reply.send({ ok: true });
  });

  app.get('/email-delivery-log', { preHandler: [authenticate] }, async (request, reply) => {
    const user = request.user as JwtUser;
    if (!hasPlatformAccess(user)) return reply.status(403).send({ error: 'Acesso restrito à plataforma' });
    const q = request.query as { workspace_id?: string; limit?: string };
    const limit = Math.min(200, Math.max(1, Number(q.limit) || 50));
    let query = supabase
      .from('email_delivery_log')
      .select('id, workspace_id, template_key, recipient, status, error_message, metadata, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (q.workspace_id) query = query.eq('workspace_id', q.workspace_id);
    const { data, error } = await query;
    if (error) {
      if ((error.message || '').includes('email_delivery_log')) return reply.send({ items: [] });
      return reply.status(500).send({ error: error.message });
    }
    return reply.send({ items: data || [] });
  });
}

import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { writeAuditLog } from '../lib/auditLog';
import { requireWorkspace } from '../lib/workspaceContext';
import { readWorkspaceSetting, upsertWorkspaceSetting } from '../lib/workspaceSettings';
import { DEFAULT_REPORT_TARGETS, mergeReportTargets, type ReportTargets } from '../lib/reportTargets';

const KEYS = {
  display_name: 'workspace_display_name',
  slug: 'workspace_slug',
  cnpj: 'workspace_cnpj',
  logo_url: 'workspace_logo_url',
  timezone: 'workspace_timezone',
} as const;

function unwrapTimezone(val: unknown): string {
  if (val == null) return 'America/Sao_Paulo';
  if (typeof val === 'string') return val.replace(/^"|"$/g, '') || 'America/Sao_Paulo';
  if (typeof val === 'object' && val !== null && 'timezone' in val) {
    const t = (val as { timezone?: unknown }).timezone;
    if (typeof t === 'string' && t) return t;
  }
  return 'America/Sao_Paulo';
}

function unwrapString(val: unknown, fallback: string): string {
  if (val == null) return fallback;
  if (typeof val === 'number' || typeof val === 'boolean') return String(val);
  if (typeof val === 'string') {
    const t = val.trim();
    if (!t) return fallback;
    if ((t.startsWith('"') && t.endsWith('"')) || t.startsWith('{')) {
      try {
        const parsed = JSON.parse(t) as unknown;
        if (typeof parsed === 'string') return parsed || fallback;
      } catch {
        /* valor literal */
      }
    }
    return t;
  }
  return fallback;
}

const patchSchema = z.object({
  display_name: z.string().min(2).max(120).optional(),
  slug: z.string().min(2).max(64).regex(/^[a-z0-9-]+$/).optional(),
  cnpj: z.string().max(32).optional(),
  logo_url: z.union([z.string().url(), z.literal('')]).optional(),
  timezone: z.string().min(2).max(80).optional(),
});

export async function workspaceRoutes(app: FastifyInstance) {
  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    try {
      const { data: workspace, error } = await supabase
        .from('workspaces')
        .select('id, display_name, slug, cnpj, logo_url, timezone')
        .eq('id', workspaceId)
        .single();
      if (error) throw new Error(error.message);

      const [display_name, slug, cnpj, logo_url, timezoneVal] = await Promise.all([
        readWorkspaceSetting(workspaceId, KEYS.display_name),
        readWorkspaceSetting(workspaceId, KEYS.slug),
        readWorkspaceSetting(workspaceId, KEYS.cnpj),
        readWorkspaceSetting(workspaceId, KEYS.logo_url),
        readWorkspaceSetting(workspaceId, KEYS.timezone),
      ]);
      return reply.send({
        id: workspace.id,
        display_name: unwrapString(display_name, String(workspace.display_name || 'Flux Farma')),
        slug: unwrapString(slug, String(workspace.slug || 'workspace')),
        cnpj: unwrapString(cnpj, String(workspace.cnpj || '')),
        logo_url: unwrapString(logo_url, String(workspace.logo_url || '')),
        timezone: unwrapTimezone(timezoneVal ?? workspace.timezone),
      });
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao ler workspace' });
    }
  });

  app.patch('/', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = patchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    const b = parsed.data;
    const actor = (request.user as { sub: string }).sub;
    try {
      const workspaceUpdates: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (b.display_name !== undefined) {
        workspaceUpdates.display_name = b.display_name;
        await upsertWorkspaceSetting(workspaceId, KEYS.display_name, b.display_name);
      }
      if (b.slug !== undefined) {
        workspaceUpdates.slug = b.slug;
        await upsertWorkspaceSetting(workspaceId, KEYS.slug, b.slug);
      }
      if (b.cnpj !== undefined) {
        workspaceUpdates.cnpj = b.cnpj;
        await upsertWorkspaceSetting(workspaceId, KEYS.cnpj, b.cnpj);
      }
      if (b.logo_url !== undefined) {
        workspaceUpdates.logo_url = b.logo_url ? b.logo_url : null;
        await upsertWorkspaceSetting(workspaceId, KEYS.logo_url, b.logo_url || '');
      }
      if (b.timezone !== undefined) {
        workspaceUpdates.timezone = b.timezone;
        await upsertWorkspaceSetting(workspaceId, KEYS.timezone, b.timezone);
      }

      const { error } = await supabase.from('workspaces').update(workspaceUpdates).eq('id', workspaceId);
      if (error) throw new Error(error.message);

      await writeAuditLog({
        actor_id: actor,
        action: 'workspace.patch',
        entity_type: 'workspace',
        entity_id: workspaceId,
        metadata: { keys: Object.keys(b), workspace_id: workspaceId },
      });

      const { data: workspace } = await supabase
        .from('workspaces')
        .select('id, display_name, slug, cnpj, logo_url, timezone')
        .eq('id', workspaceId)
        .single();
      const [display_name, slug, cnpj, logo_url, timezoneVal] = await Promise.all([
        readWorkspaceSetting(workspaceId, KEYS.display_name),
        readWorkspaceSetting(workspaceId, KEYS.slug),
        readWorkspaceSetting(workspaceId, KEYS.cnpj),
        readWorkspaceSetting(workspaceId, KEYS.logo_url),
        readWorkspaceSetting(workspaceId, KEYS.timezone),
      ]);
      return reply.send({
        id: workspace?.id,
        display_name: unwrapString(display_name, String(workspace?.display_name || 'Flux Farma')),
        slug: unwrapString(slug, String(workspace?.slug || 'workspace')),
        cnpj: unwrapString(cnpj, String(workspace?.cnpj || '')),
        logo_url: unwrapString(logo_url, String(workspace?.logo_url || '')),
        timezone: unwrapTimezone(timezoneVal ?? workspace?.timezone),
      });
    } catch (e: unknown) {
      return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao gravar workspace' });
    }
  });

  app.get('/report-targets', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('workspace_report_targets')
      .select('settings')
      .eq('workspace_id', workspaceId)
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    const settings = mergeReportTargets(data?.settings);
    return reply.send({ settings, defaults: DEFAULT_REPORT_TARGETS });
  });

  const targetsSchema = z.object({
    settings: z.object({
      tmr: z.number().optional(),
      tma: z.number().optional(),
      slaPct: z.number().optional(),
      csat: z.number().optional(),
      fcrPct: z.number().optional(),
      reaberturaPct: z.number().optional(),
    }),
  });

  app.put('/report-targets', { preHandler: [authenticate, requireRole('admin')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = targetsSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    const settings: ReportTargets = mergeReportTargets(parsed.data.settings);
    const { error } = await supabase.from('workspace_report_targets').upsert(
      { workspace_id: workspaceId, settings, updated_at: new Date().toISOString() },
      { onConflict: 'workspace_id' }
    );
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ settings });
  });
}

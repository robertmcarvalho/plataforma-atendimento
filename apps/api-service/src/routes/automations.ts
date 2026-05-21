import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { PubSub } from '@google-cloud/pubsub';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { requireWorkspace } from '../lib/workspaceContext';

type JsonRecord = Record<string, unknown>;

const pubsub = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID });

const runNowSchema = z.object({
  // Optional context to be used by variables_mapping (context.*) and custom audiences (context.phones).
  context: z.record(z.unknown()).optional(),
});

export async function automationRoutes(app: FastifyInstance) {
  app.get('/runtime-stats', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const q = request.query as { days?: string | number } | undefined;
    const rawDays = typeof q?.days === 'string' ? Number(q?.days) : typeof q?.days === 'number' ? q?.days : 30;
    const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(365, Math.floor(rawDays))) : 30;
    const sinceIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const [total, completed, failed] = await Promise.all([
      supabase.from('automation_runs').select('id', { count: 'exact', head: true }).eq('workspace_id', workspaceId).gte('started_at', sinceIso),
      supabase
        .from('automation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('started_at', sinceIso)
        .eq('status', 'completed'),
      supabase
        .from('automation_runs')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('started_at', sinceIso)
        .eq('status', 'failed'),
    ]);

    if (total.error) return reply.status(500).send({ error: total.error.message });
    if (completed.error) return reply.status(500).send({ error: completed.error.message });
    if (failed.error) return reply.status(500).send({ error: failed.error.message });

    const runs_total = Number(total.count || 0);
    const runs_completed = Number(completed.count || 0);
    const runs_failed = Number(failed.count || 0);
    const denom = runs_completed + runs_failed;
    const success_rate_pct = denom > 0 ? (runs_completed / denom) * 100 : null;

    return reply.send({ days, runs_total, runs_completed, runs_failed, success_rate_pct });
  });

  app.get('/', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { data, error } = await supabase
      .from('automation_rules')
      .select('*, template:message_templates(id, name), created_by_user:users!created_by(id, name)')
      .eq('workspace_id', workspaceId)
      .order('name');
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.get('/:id/runs', { preHandler: [authenticate] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('automation_runs')
      .select('*, campaign:campaigns(id, status, total_recipients, sent_count, failed_count, delivered_count, read_count, started_at, completed_at)')
      .eq('workspace_id', workspaceId)
      .eq('rule_id', id)
      .order('started_at', { ascending: false })
      .limit(20);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // POST /api/automations/:id/run — executar manualmente (converte regra em campanha + publica em campaign.dispatch)
  app.post('/:id/run', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = runNowSchema.safeParse(request.body || {});
    if (!body.success) return reply.status(400).send({ error: 'Dados invalidos', details: body.error.flatten() });

    const user = request.user as { sub: string };
    const context = (body.data.context || {}) as JsonRecord;

    const { data: rule, error: ruleError } = await supabase
      .from('automation_rules')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    if (ruleError || !rule) return reply.status(404).send({ error: 'Regra nao encontrada' });

    if (rule.require_approval) {
      return reply.status(400).send({ error: 'Esta automacao exige aprovacao e nao pode ser executada manualmente.' });
    }

    if (!rule.template_id) {
      return reply.status(400).send({ error: 'Automacao sem template configurado.' });
    }

    const { data: template, error: templateError } = await supabase
      .from('message_templates')
      .select('id, meta_template_status, is_active')
      .eq('workspace_id', workspaceId)
      .eq('id', rule.template_id)
      .single();

    if (templateError || !template) return reply.status(400).send({ error: 'Template nao encontrado.' });
    if (!template.is_active || template.meta_template_status !== 'approved') {
      return reply.status(400).send({ error: 'Template nao esta apto para envio automatico.' });
    }

    const startedAt = new Date().toISOString();

    // Registrar run
    const { data: runRow, error: runError } = await supabase
      .from('automation_runs')
      .insert({
        workspace_id: workspaceId,
        rule_id: id,
        status: 'running',
        started_at: startedAt,
      })
      .select('id')
      .single();

    if (runError || !runRow) return reply.status(500).send({ error: runError?.message || 'Falha ao registrar run' });

    const runId = runRow.id as string;
    let campaignId: string | null = null;

    try {
      const recipients = await resolveAudience(
        workspaceId,
        rule.audience_type as string | null,
        (rule.audience_filters || {}) as JsonRecord,
        (rule.variables_mapping || {}) as JsonRecord,
        context
      );

      if (recipients.length === 0) {
        await supabase
          .from('automation_runs')
          .update({ status: 'completed', total_recipients: 0, completed_at: new Date().toISOString() })
          .eq('id', runId);
        return reply.send({ status: 'completed', run_id: runId, total_recipients: 0 });
      }

      const { data: campaign, error: campaignError } = await supabase
        .from('campaigns')
        .insert({
          workspace_id: workspaceId,
          name: `[AUTO-MANUAL] ${rule.name} - ${startedAt.replace('T', ' ').slice(0, 16)}`,
          type: 'automated',
          status: 'running',
          template_id: rule.template_id,
          audience_type: rule.audience_type,
          audience_filters: rule.audience_filters || {},
          total_recipients: recipients.length,
          dispatch_config: rule.dispatch_config || {},
          created_by: user.sub,
          started_at: startedAt,
          updated_at: startedAt,
        })
        .select('id')
        .single();

      if (campaignError || !campaign) {
        throw new Error(campaignError?.message || 'Falha ao criar campanha');
      }

      campaignId = campaign.id as string;

      const rows = recipients.map((r) => ({
        workspace_id: workspaceId,
        campaign_id: campaignId,
        contact_id: r.contact_id || null,
        wa_phone: r.wa_phone,
        variables: r.variables,
        status: 'pending',
      }));

      const { error: recError } = await supabase.from('campaign_recipients').insert(rows.map((row) => ({ ...row, workspace_id: workspaceId })));
      if (recError) throw new Error(recError.message);

      const { error: linkError } = await supabase
        .from('automation_runs')
        .update({ campaign_id: campaignId, total_recipients: recipients.length })
        .eq('id', runId);
      if (linkError) throw new Error(linkError.message);

      await publishCampaignDispatch(campaignId, workspaceId);

      return reply.send({ status: 'running', run_id: runId, campaign_id: campaignId, total_recipients: recipients.length });
    } catch (error) {
      if (campaignId) {
        await supabase
          .from('campaigns')
          .update({ status: 'failed', completed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
          .eq('id', campaignId);
      }

      await supabase
        .from('automation_runs')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', runId);

      return reply.status(500).send({ error: error instanceof Error ? error.message : 'Falha ao executar automacao' });
    }
  });

  app.post('/', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const user = request.user as { sub: string };
    const body = request.body as Record<string, unknown>;
    const { data, error } = await supabase
      .from('automation_rules')
      .insert({ ...body, workspace_id: workspaceId, created_by: user.sub, is_active: false })
      .select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.status(201).send(data);
  });

  app.put('/:id', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const body = request.body as Record<string, unknown>;
    const { data, error } = await supabase
      .from('automation_rules')
      .update({ ...body, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.patch('/:id/toggle', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data: current } = await supabase.from('automation_rules').select('is_active').eq('workspace_id', workspaceId).eq('id', id).single();
    const { data, error } = await supabase
      .from('automation_rules')
      .update({ is_active: !current?.is_active, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  app.delete('/:id', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { error } = await supabase.from('automation_rules').delete().eq('workspace_id', workspaceId).eq('id', id);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ ok: true });
  });
}

type AudienceRecipient = {
  contact_id?: string | null;
  wa_phone: string;
  variables: Record<string, string>;
  source: JsonRecord;
};

async function publishCampaignDispatch(campaignId: string, workspaceId: string) {
  const topic = process.env.PUBSUB_TOPIC_CAMPAIGN;
  if (!topic) throw new Error('PUBSUB_TOPIC_CAMPAIGN nao configurado');
  const data = Buffer.from(JSON.stringify({ campaign_id: campaignId, workspace_id: workspaceId }));
  await pubsub.topic(topic).publishMessage({ data });
}

async function resolveAudience(
  workspaceId: string,
  audienceType: string | null,
  filters: JsonRecord,
  variablesMapping: JsonRecord,
  context: JsonRecord
): Promise<AudienceRecipient[]> {
  if (audienceType === 'drivers') {
    let query = supabase
      .from('drivers')
      .select('id, name, phone, primary_pharmacy_id, doc_status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .not('phone', 'is', null);

    if (typeof filters.pharmacy_id === 'string') query = query.eq('primary_pharmacy_id', filters.pharmacy_id);
    if (typeof filters.doc_status === 'string') query = query.eq('doc_status', filters.doc_status);

    const { data } = await query;
    return dedupeRecipients(
      (data || []).map((driver: Record<string, unknown>) => ({
        wa_phone: String(driver.phone || ''),
        variables: applyVariableMappings({ nome: String(driver.name || '') }, variablesMapping, context, driver),
        source: driver,
      }))
    );
  }

  if (audienceType === 'leaders') {
    const { data } = await supabase
      .from('leaders')
      .select('id, name, phone, city, state')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .not('phone', 'is', null);
    return dedupeRecipients(
      (data || []).map((leader: Record<string, unknown>) => ({
        wa_phone: String(leader.phone || ''),
        variables: applyVariableMappings({ nome: String(leader.name || '') }, variablesMapping, context, leader),
        source: leader,
      }))
    );
  }

  if (audienceType === 'pharmacies') {
    const { data } = await supabase
      .from('pharmacies')
      .select('id, trade_name, phone, city, state')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .not('phone', 'is', null);
    return dedupeRecipients(
      (data || []).map((pharmacy: Record<string, unknown>) => ({
        wa_phone: String(pharmacy.phone || ''),
        variables: applyVariableMappings({ nome: String(pharmacy.trade_name || '') }, variablesMapping, context, pharmacy),
        source: pharmacy,
      }))
    );
  }

  if (audienceType === 'custom') {
    const phones = [...extractPhones(filters.phones), ...extractPhones((context as Record<string, unknown>).phones)];
    return dedupeRecipients(
      phones.map((phone) => ({
        wa_phone: phone,
        variables: applyVariableMappings({}, variablesMapping, context, { phone }),
        source: { phone },
      }))
    );
  }

  return [];
}

function dedupeRecipients(recipients: AudienceRecipient[]) {
  const seen = new Set<string>();
  return recipients.filter((recipient) => {
    const phone = normalizePhone(recipient.wa_phone);
    if (!phone || seen.has(phone)) return false;
    seen.add(phone);
    recipient.wa_phone = phone;
    return true;
  });
}

function normalizePhone(value: unknown) {
  if (typeof value !== 'string') return null;
  const phone = value.trim();
  return phone.length > 0 ? phone : null;
}

function extractPhones(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function applyVariableMappings(
  baseVariables: Record<string, string>,
  variablesMapping: JsonRecord,
  context: JsonRecord,
  source: JsonRecord
) {
  const resolvedVariables = { ...baseVariables };

  for (const [variableName, mapping] of Object.entries(variablesMapping || {})) {
    const resolved = resolveMappedValue(mapping, {
      context,
      recipient: source,
      variables: resolvedVariables,
    });
    if (resolved !== null) resolvedVariables[variableName] = resolved;
  }

  return resolvedVariables;
}

function resolveMappedValue(mapping: unknown, scope: JsonRecord): string | null {
  if (typeof mapping === 'string') {
    if (mapping.startsWith('context.') || mapping.startsWith('recipient.') || mapping.startsWith('variables.')) {
      return stringifyValue(resolvePath(scope, mapping));
    }
    return stringifyValue(mapping);
  }

  if (isRecord(mapping)) {
    if (typeof mapping.path === 'string') return stringifyValue(resolvePath(scope, mapping.path));
    if ('value' in mapping) return stringifyValue(mapping.value);
  }

  return stringifyValue(mapping);
}

function resolvePath(source: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  let node: any = source;
  for (const part of parts) {
    if (!node || typeof node !== 'object') return null;
    node = (node as any)[part];
  }
  return node;
}

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

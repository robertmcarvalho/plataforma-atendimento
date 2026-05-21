import 'dotenv/config';
import { createServer } from 'http';
import cron from 'node-cron';
import { PubSub } from '@google-cloud/pubsub';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@plataforma/logger';
import { registerTicketSlaJobs } from './jobs/ticketsSlaJobs';
import { registerAdvanceTasksSlaJobs } from './jobs/advanceTasksSlaJobs';
import { registerQueueSlaJobs } from './jobs/queueSlaJobs';

type JsonRecord = Record<string, unknown>;

type AutomationRule = {
  id: string;
  workspace_id: string;
  name: string;
  trigger_type: string;
  cron_expression: string | null;
  event_type: string | null;
  audience_type: string | null;
  audience_filters: JsonRecord | null;
  template_id: string | null;
  variables_mapping: JsonRecord | null;
  dispatch_config: JsonRecord | null;
  require_approval: boolean;
  created_by: string | null;
};

type AudienceRecipient = {
  contact_id?: string | null;
  wa_phone: string;
  variables: Record<string, string>;
  source: JsonRecord;
};

const pubsub = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const logger = createLogger('scheduler-service');
const console = logger.console;
const schedulerTimezone = process.env.TZ || 'America/Sao_Paulo';
const ticketSlaJobs = registerTicketSlaJobs(supabase, schedulerTimezone);
const advanceSlaJobs = registerAdvanceTasksSlaJobs(supabase, schedulerTimezone);
const queueSlaJobs = registerQueueSlaJobs(supabase, schedulerTimezone);

console.log('Scheduler Service iniciando...');

// ============================================================
// CRON: Marcar parcelas vencidas (todo dia 00:05)
// ============================================================
cron.schedule('5 0 * * *', async () => {
  console.log('[Cron] Atualizando parcelas vencidas...');
  const today = new Date().toISOString().split('T')[0];
  const { error } = await supabase
    .from('financial_installments')
    .update({ status: 'overdue' })
    .eq('status', 'pending')
    .lt('due_date', today);

  if (error) {
    console.error('[Cron] Erro ao atualizar parcelas:', error);
  } else {
    console.log('[Cron] Parcelas vencidas atualizadas.');
  }
}, { timezone: schedulerTimezone });

// ============================================================
// CRON: Aviso de desconto semanal (toda segunda 08:00)
// ============================================================
cron.schedule('0 8 * * 1', async () => {
  console.log('[Cron] Disparando avisos de desconto semanal...');

  const weekStart = new Date();
  const weekEnd = new Date();
  weekEnd.setDate(weekEnd.getDate() + 6);

  const { data: installments } = await supabase
    .from('financial_installments')
    .select(`
      id, amount, due_date, reference,
      financial_entries(
        type,
        drivers(id, name, phone)
      )
    `)
    .eq('status', 'pending')
    .eq('financial_entries.status', 'active')
    .gte('due_date', weekStart.toISOString().split('T')[0])
    .lte('due_date', weekEnd.toISOString().split('T')[0]);

  if (!installments?.length) {
    console.log('[Cron] Nenhuma parcela esta semana.');
    return;
  }

  await triggerAutomation('installment_due_weekly', { installments });
}, { timezone: schedulerTimezone });

// ============================================================
// CRON: Verificar regras de automacao configuradas (a cada 5 min)
// ============================================================
cron.schedule('*/5 * * * *', async () => {
  const { data: rules } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('trigger_type', 'schedule')
    .eq('is_active', true);

  if (!rules?.length) {
    return;
  }

  for (const rule of rules as AutomationRule[]) {
    if (shouldRunNow(rule.cron_expression)) {
      await scheduleAutomationRun(rule);
    }
  }
}, { timezone: schedulerTimezone });

// ============================================================
// CRON: Alertas de SLA (a cada 2 minutos)
// ============================================================
cron.schedule('*/2 * * * *', async () => {
  const now = new Date();
  const warningThreshold = new Date(now.getTime() + 30 * 60 * 1000).toISOString();

  const { data: atRisk } = await supabase
    .from('conversations')
    .select('id, attendant_id, sla_resolution_deadline')
    .in('status', ['open', 'pending'])
    .not('sla_resolution_deadline', 'is', null)
    .lte('sla_resolution_deadline', warningThreshold)
    .gt('sla_resolution_deadline', now.toISOString())
    .eq('sla_first_response_ok', true);

  const { data: breached } = await supabase
    .from('conversations')
    .select('id, attendant_id, sla_resolution_deadline')
    .in('status', ['open', 'pending'])
    .not('sla_resolution_deadline', 'is', null)
    .lt('sla_resolution_deadline', now.toISOString())
    .eq('sla_resolved_ok', false);

  for (const conversation of [...(atRisk || []), ...(breached || [])]) {
    const severity = (breached || []).some((item) => item.id === conversation.id) ? 'critical' : 'warning';
    const eventType = severity === 'critical' ? 'breach_resolution' : 'warning_resolution';

    const { data: existing } = await supabase
      .from('sla_events')
      .select('id')
      .eq('conversation_id', conversation.id)
      .eq('event_type', eventType)
      .gte('created_at', new Date(now.getTime() - 10 * 60 * 1000).toISOString())
      .single();

    if (!existing) {
      await supabase.from('sla_events').insert({
        conversation_id: conversation.id,
        event_type: eventType,
        severity,
        notified_attendant: false,
        notified_supervisor: false,
      });
      console.log(`[SLA] Alerta ${severity} registrado para conversa ${conversation.id}`);
    }
  }
}, { timezone: schedulerTimezone });

// ============================================================
// CRON: SLA de tickets (alerta 80% e escalonamento) - a cada 2 min
// ============================================================
cron.schedule('*/2 * * * *', async () => {
  try {
    await ticketSlaJobs.runAlert80Job();
    await ticketSlaJobs.runEscalationJob();
  } catch (err) {
    console.error('[Cron] Erro nos jobs de SLA de tickets:', err);
  }
}, { timezone: schedulerTimezone });

// ============================================================
// CRON: SLA de adiantamento (a cada 1 minuto)
// ============================================================
cron.schedule('* * * * *', async () => {
  try {
    await advanceSlaJobs.runAdvanceSlaJob();
  } catch (err) {
    console.error('[Cron] Erro nos jobs de SLA de adiantamento:', err);
  }
}, { timezone: schedulerTimezone });

// ============================================================
// CRON: SLA de tratamento de queue_sla (a cada 1 minuto)
// ============================================================
cron.schedule('* * * * *', async () => {
  try {
    await queueSlaJobs.runQueueSlaJob();
  } catch (err) {
    console.error('[Cron] Erro no job de SLA queue_sla:', err);
  }
}, { timezone: schedulerTimezone });

// ============================================================
// CRON: Relatorio diario de tickets por supervisor (18:00)
// ============================================================
cron.schedule('0 18 * * *', async () => {
  try {
    await ticketSlaJobs.runDailyReportJob();
  } catch (err) {
    console.error('[Cron] Erro no relatorio diario de tickets:', err);
  }
}, { timezone: schedulerTimezone });

// ============================================================
// CRON: Limpeza de eventos de webhook antigos (todo domingo 03:00)
// ============================================================
cron.schedule('0 3 * * 0', async () => {
  const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const { error } = await supabase
    .from('processed_webhook_events')
    .delete()
    .lt('processed_at', cutoff);

  if (error) {
    console.error('[Cron] Erro ao limpar eventos de webhook:', error);
  } else {
    console.log('[Cron] Eventos antigos de webhook removidos.');
  }
}, { timezone: schedulerTimezone });

// ============================================================
// Helpers
// ============================================================
async function triggerAutomation(eventType: string, context: JsonRecord) {
  const { data: rules } = await supabase
    .from('automation_rules')
    .select('*')
    .eq('trigger_type', 'event')
    .eq('event_type', eventType)
    .eq('is_active', true);

  for (const rule of (rules || []) as AutomationRule[]) {
    await scheduleAutomationRun(rule, context);
  }
}

async function scheduleAutomationRun(rule: AutomationRule, context: JsonRecord = {}) {
  const startedAt = new Date().toISOString();
  console.log(`[Scheduler] Preparando automacao: ${rule.name}`);

  const { data: runRow, error: runInsertError } = await supabase
    .from('automation_runs')
    .insert({
      workspace_id: rule.workspace_id,
      rule_id: rule.id,
      status: 'running',
      started_at: startedAt,
    })
    .select('id')
    .single();

  if (runInsertError || !runRow) {
    console.error(`[Scheduler] Falha ao registrar automation_run para ${rule.name}:`, runInsertError);
    return;
  }

  const runId = runRow.id as string;
  let campaignId: string | null = null;

  try {
    if (rule.require_approval) {
      console.warn(`[Scheduler] Automacao ${rule.name} exige aprovacao e foi ignorada.`);
      await finalizeAutomationRun(runId, 'failed');
      return;
    }

    if (!rule.template_id) {
      throw new Error(`Automacao ${rule.name} sem template configurado`);
    }

    const { data: template, error: templateError } = await supabase
      .from('message_templates')
      .select('id, meta_template_status, is_active')
      .eq('workspace_id', rule.workspace_id)
      .eq('id', rule.template_id)
      .single();

    if (templateError || !template) {
      throw new Error(`Template ${rule.template_id} nao encontrado para automacao ${rule.name}`);
    }

    if (!template.is_active || template.meta_template_status !== 'approved') {
      throw new Error(`Template ${rule.template_id} nao esta apto para envio automatico`);
    }

    const recipients = await resolveAudience(
      rule.workspace_id,
      rule.audience_type,
      rule.audience_filters || {},
      rule.variables_mapping || {},
      context,
    );

    if (recipients.length === 0) {
      console.log(`[Scheduler] Automacao ${rule.name} nao encontrou destinatarios.`);
      await supabase
        .from('automation_runs')
        .update({
          status: 'completed',
          total_recipients: 0,
          completed_at: new Date().toISOString(),
        })
        .eq('workspace_id', rule.workspace_id)
        .eq('id', runId);
      return;
    }

    const { data: campaign, error: campaignError } = await supabase
      .from('campaigns')
      .insert({
        workspace_id: rule.workspace_id,
        name: buildAutomationCampaignName(rule.name, startedAt),
        type: 'automated',
        status: 'running',
        template_id: rule.template_id,
        audience_type: rule.audience_type,
        audience_filters: rule.audience_filters || {},
        total_recipients: recipients.length,
        dispatch_config: rule.dispatch_config || {},
        created_by: rule.created_by,
        started_at: startedAt,
        updated_at: startedAt,
      })
      .select('id')
      .single();

    if (campaignError || !campaign) {
      throw new Error(`Falha ao criar campanha para automacao ${rule.name}: ${campaignError?.message || 'erro desconhecido'}`);
    }

    campaignId = campaign.id as string;

    const recipientRows = recipients.map((recipient) => ({
      workspace_id: rule.workspace_id,
      campaign_id: campaignId,
      contact_id: recipient.contact_id || null,
      wa_phone: recipient.wa_phone,
      variables: recipient.variables,
      status: 'pending',
    }));

    const { error: recipientsError } = await supabase.from('campaign_recipients').insert(recipientRows);
    if (recipientsError) {
      throw new Error(`Falha ao criar destinatarios da campanha ${campaignId}: ${recipientsError.message}`);
    }

    const { error: runUpdateError } = await supabase
      .from('automation_runs')
      .update({
        campaign_id: campaignId,
        total_recipients: recipients.length,
      })
      .eq('workspace_id', rule.workspace_id)
      .eq('id', runId);

    if (runUpdateError) {
      throw new Error(`Falha ao vincular campaign_id na automacao ${rule.name}: ${runUpdateError.message}`);
    }

    await publishCampaignDispatch(campaignId, rule.workspace_id);
    console.log(`[Scheduler] Automacao ${rule.name} publicada como campanha ${campaignId}.`);
  } catch (error) {
    console.error(`[Scheduler] Erro ao executar automacao ${rule.name}:`, error);

    if (campaignId) {
      await supabase
        .from('campaigns')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('workspace_id', rule.workspace_id)
        .eq('id', campaignId);
    }

    await finalizeAutomationRun(runId, 'failed');
  }
}

async function finalizeAutomationRun(runId: string, status: 'completed' | 'failed') {
  await supabase
    .from('automation_runs')
    .update({
      status,
      completed_at: new Date().toISOString(),
    })
    .eq('id', runId);
}

async function publishCampaignDispatch(campaignId: string, workspaceId: string) {
  const campaignTopic = process.env.PUBSUB_TOPIC_CAMPAIGN;
  if (!campaignTopic) {
    throw new Error('PUBSUB_TOPIC_CAMPAIGN nao configurado');
  }

  const data = Buffer.from(JSON.stringify({ campaign_id: campaignId, workspace_id: workspaceId }));
  await pubsub.topic(campaignTopic).publishMessage({ data });
}

async function resolveAudience(
  workspaceId: string,
  audienceType: string | null,
  filters: JsonRecord,
  variablesMapping: JsonRecord,
  context: JsonRecord,
): Promise<AudienceRecipient[]> {
  if (audienceType === 'drivers') {
    let query = supabase
      .from('drivers')
      .select('id, name, phone, primary_pharmacy_id, doc_status')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .not('phone', 'is', null);

    if (typeof filters.pharmacy_id === 'string') {
      query = query.eq('primary_pharmacy_id', filters.pharmacy_id);
    }

    if (typeof filters.doc_status === 'string') {
      query = query.eq('doc_status', filters.doc_status);
    }

    const { data } = await query;

    return dedupeRecipients((data || []).map((driver) => ({
      wa_phone: String(driver.phone),
      variables: applyVariableMappings(
        { nome: String(driver.name || '') },
        variablesMapping,
        context,
        driver as JsonRecord,
      ),
      source: driver as JsonRecord,
    })));
  }

  if (audienceType === 'leaders') {
    const { data } = await supabase
      .from('leaders')
      .select('id, name, phone, city, state')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .not('phone', 'is', null);

    return dedupeRecipients((data || []).map((leader) => ({
      wa_phone: String(leader.phone),
      variables: applyVariableMappings(
        { nome: String(leader.name || '') },
        variablesMapping,
        context,
        leader as JsonRecord,
      ),
      source: leader as JsonRecord,
    })));
  }

  if (audienceType === 'pharmacies') {
    const { data } = await supabase
      .from('pharmacies')
      .select('id, trade_name, phone, city, state')
      .eq('workspace_id', workspaceId)
      .eq('status', 'active')
      .not('phone', 'is', null);

    return dedupeRecipients((data || []).map((pharmacy) => ({
      wa_phone: String(pharmacy.phone),
      variables: applyVariableMappings(
        { nome: String(pharmacy.trade_name || '') },
        variablesMapping,
        context,
        pharmacy as JsonRecord,
      ),
      source: pharmacy as JsonRecord,
    })));
  }

  if (audienceType === 'custom') {
    const phones = [
      ...extractPhones(filters.phones),
      ...extractPhones(context.phones),
    ];

    return dedupeRecipients(phones.map((phone) => ({
      wa_phone: phone,
      variables: applyVariableMappings({}, variablesMapping, context, { phone }),
      source: { phone },
    })));
  }

  return [];
}

function buildAutomationCampaignName(ruleName: string, startedAt: string) {
  return `[AUTO] ${ruleName} - ${startedAt.replace('T', ' ').slice(0, 16)}`;
}

function dedupeRecipients(recipients: AudienceRecipient[]) {
  const seen = new Set<string>();

  return recipients.filter((recipient) => {
    const phone = normalizePhone(recipient.wa_phone);
    if (!phone || seen.has(phone)) {
      return false;
    }

    seen.add(phone);
    recipient.wa_phone = phone;
    return true;
  });
}

function normalizePhone(value: unknown) {
  if (typeof value !== 'string') {
    return null;
  }

  const phone = value.trim();
  return phone.length > 0 ? phone : null;
}

function extractPhones(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function applyVariableMappings(
  baseVariables: Record<string, string>,
  variablesMapping: JsonRecord,
  context: JsonRecord,
  source: JsonRecord,
) {
  const resolvedVariables = { ...baseVariables };

  for (const [variableName, mapping] of Object.entries(variablesMapping || {})) {
    const resolved = resolveMappedValue(mapping, {
      context,
      recipient: source,
      variables: resolvedVariables,
    });

    if (resolved !== null) {
      resolvedVariables[variableName] = resolved;
    }
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
    if (typeof mapping.path === 'string') {
      return stringifyValue(resolvePath(scope, mapping.path));
    }

    if ('value' in mapping) {
      return stringifyValue(mapping.value);
    }
  }

  return stringifyValue(mapping);
}

function resolvePath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current) || !(segment in current)) {
      return undefined;
    }

    return current[segment];
  }, source);
}

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return JSON.stringify(value);
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function shouldRunNow(cronExpression: string | null, now = new Date()): boolean {
  if (!cronExpression || !cron.validate(cronExpression)) {
    return false;
  }

  const parts = cronExpression.trim().split(/\s+/);
  if (parts.length !== 5) {
    return false;
  }

  const [minute, hour, dayOfMonth, month, weekDay] = parts;

  return matchesCronField(minute, now.getMinutes(), 0, 59)
    && matchesCronField(hour, now.getHours(), 0, 23)
    && matchesCronField(dayOfMonth, now.getDate(), 1, 31)
    && matchesCronField(month, now.getMonth() + 1, 1, 12)
    && matchesCronField(weekDay, now.getDay(), 0, 7, true);
}

function matchesCronField(field: string, value: number, min: number, max: number, sundayCanBeSeven = false) {
  const normalizedField = field === '?' ? '*' : field;
  const candidateValues = sundayCanBeSeven && value === 0 ? [0, 7] : [value];

  return normalizedField.split(',').some((segment) =>
    candidateValues.some((candidate) => matchesCronSegment(segment, candidate, min, max)),
  );
}

function matchesCronSegment(segment: string, value: number, min: number, max: number) {
  const [base, stepToken] = segment.split('/');
  const step = stepToken ? Number(stepToken) : 1;

  if (!Number.isInteger(step) || step <= 0) {
    return false;
  }

  const range = parseCronRange(base, min, max);
  if (!range) {
    return false;
  }

  if (value < range.start || value > range.end) {
    return false;
  }

  return (value - range.start) % step === 0;
}

function parseCronRange(token: string | undefined, min: number, max: number) {
  if (!token || token === '*') {
    return { start: min, end: max };
  }

  if (token.includes('-')) {
    const [startToken, endToken] = token.split('-');
    const start = Number(startToken);
    const end = Number(endToken);
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < min || end > max || start > end) {
      return null;
    }

    return { start, end };
  }

  const value = Number(token);
  if (!Number.isInteger(value) || value < min || value > max) {
    return null;
  }

  return { start: value, end: value };
}

startHealthServer();

function startHealthServer() {
  const port = Number(process.env.PORT) || 3004;
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        status: 'ok',
        service: 'scheduler-service',
        timezone: schedulerTimezone,
        campaign_topic: process.env.PUBSUB_TOPIC_CAMPAIGN || null,
        ts: new Date().toISOString(),
      }));
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Scheduler health server rodando na porta ${port}`);
  });
}

console.log('Scheduler Service rodando. Crons ativos:');
console.log('  - 00:05 diario: Marcar parcelas vencidas');
console.log('  - 08:00 seg: Avisos de desconto semanal');
console.log('  - */5 min: Verificar automacoes configuradas');
console.log('  - */2 min: Alertas de SLA');
console.log('  - */2 min: SLA tickets (80% + escalonamento)');
console.log('  - * min: SLA adiantamento (80%, vencido, lembrete, escalonamento)');
console.log('  - * min: SLA queue_sla (tratamento, alerta e escalonamento)');
console.log('  - 18:00 diario: Relatorio de tickets para supervisor');
console.log('  - 03:00 dom: Limpeza de webhooks antigos');

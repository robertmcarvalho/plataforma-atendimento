import type { SupabaseClient } from '@supabase/supabase-js';
import type { PubSub } from '@google-cloud/pubsub';
import { shouldRunNow } from './cronMatch';
import {
  AUTOMATION_RULE_COLUMNS,
  type AudienceRecipient,
  type AutomationRule,
  type JsonRecord,
} from './types';

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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

function resolvePath(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((current, segment) => {
    if (!isRecord(current) || !(segment in current)) return undefined;
    return current[segment];
  }, source);
}

function stringifyValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
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
    if (resolved !== null) resolvedVariables[variableName] = resolved;
  }
  return resolvedVariables;
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

function buildAutomationCampaignName(ruleName: string, startedAt: string) {
  return `[AUTO] ${ruleName} - ${startedAt.replace('T', ' ').slice(0, 16)}`;
}

export function createAutomationEngine(supabase: SupabaseClient, pubsub: PubSub) {
  async function finalizeAutomationRun(runId: string, status: 'completed' | 'failed') {
    await supabase
      .from('automation_runs')
      .update({ status, completed_at: new Date().toISOString() })
      .eq('id', runId);
  }

  async function publishCampaignDispatch(campaignId: string, workspaceId: string) {
    const campaignTopic = process.env.PUBSUB_TOPIC_CAMPAIGN;
    if (!campaignTopic) throw new Error('PUBSUB_TOPIC_CAMPAIGN nao configurado');
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

      if (typeof filters.pharmacy_id === 'string') query = query.eq('primary_pharmacy_id', filters.pharmacy_id);
      if (typeof filters.doc_status === 'string') query = query.eq('doc_status', filters.doc_status);

      const { data } = await query;
      return dedupeRecipients((data || []).map((driver) => ({
        wa_phone: String(driver.phone),
        variables: applyVariableMappings({ nome: String(driver.name || '') }, variablesMapping, context, driver as JsonRecord),
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
        variables: applyVariableMappings({ nome: String(leader.name || '') }, variablesMapping, context, leader as JsonRecord),
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
        variables: applyVariableMappings({ nome: String(pharmacy.trade_name || '') }, variablesMapping, context, pharmacy as JsonRecord),
        source: pharmacy as JsonRecord,
      })));
    }

    if (audienceType === 'custom') {
      const phones = [...extractPhones(filters.phones), ...extractPhones(context.phones)];
      return dedupeRecipients(phones.map((phone) => ({
        wa_phone: phone,
        variables: applyVariableMappings({}, variablesMapping, context, { phone }),
        source: { phone },
      })));
    }

    return [];
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

      if (!rule.template_id) throw new Error(`Automacao ${rule.name} sem template configurado`);

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
        .update({ campaign_id: campaignId, total_recipients: recipients.length })
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

  async function triggerAutomation(eventType: string, context: JsonRecord) {
    const { data: rules } = await supabase
      .from('automation_rules')
      .select(AUTOMATION_RULE_COLUMNS)
      .eq('trigger_type', 'event')
      .eq('event_type', eventType)
      .eq('is_active', true);

    for (const rule of (rules || []) as AutomationRule[]) {
      await scheduleAutomationRun(rule, context);
    }
  }

  async function runScheduledAutomationRules() {
    const { data: rules } = await supabase
      .from('automation_rules')
      .select(AUTOMATION_RULE_COLUMNS)
      .eq('trigger_type', 'schedule')
      .eq('is_active', true);

    if (!rules?.length) return;

    for (const rule of rules as AutomationRule[]) {
      if (shouldRunNow(rule.cron_expression)) {
        await scheduleAutomationRun(rule);
      }
    }
  }

  return { triggerAutomation, runScheduledAutomationRules, scheduleAutomationRun };
}

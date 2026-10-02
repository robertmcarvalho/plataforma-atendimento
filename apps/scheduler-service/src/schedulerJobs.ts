import type { SupabaseClient } from '@supabase/supabase-js';
import type { PubSub } from '@google-cloud/pubsub';
import type { ScheduledTask } from 'node-cron';
import cron from 'node-cron';
import { createAutomationEngine } from './lib/automation';
import { registerAdvanceTasksSlaJobs } from './jobs/advanceTasksSlaJobs';
import { registerCommercialLeadScoringJobs } from './jobs/commercialLeadScoringJobs';
import { registerDriverDocumentExpiryJobs } from './jobs/driverDocumentExpiryJobs';
import { registerFluxDeliverySyncJobs } from './jobs/fluxDeliverySyncJobs';
import { registerFluxDriverSyncJobs } from './jobs/fluxDriverSyncJobs';
import { registerOrchestratorNightModeJobs } from './jobs/orchestratorNightMode';
import { registerQueueSlaJobs } from './jobs/queueSlaJobs';
import { registerSignatureDeadlineJobs } from './jobs/signatureDeadlineJobs';
import { registerSignatureSyncJobs } from './jobs/signatureSyncJobs';
import { registerTicketSlaJobs } from './jobs/ticketsSlaJobs';
import { runCoraStatementSyncViaApi } from './jobs/coraStatementSyncJobs';
import { type JobCatalogEntry, type JobHandler } from './lib/types';

export type SchedulerJobs = {
  timezone: string;
  handlers: Record<string, JobHandler>;
  catalog: JobCatalogEntry[];
  registerCrons: () => ScheduledTask[];
  runJob: (name: string) => Promise<{ ok: boolean; error?: string }>;
};

export function createSchedulerJobs(supabase: SupabaseClient, pubsub: PubSub): SchedulerJobs {
  const timezone = process.env.TZ || 'America/Sao_Paulo';
  const ticketSlaJobs = registerTicketSlaJobs(supabase, timezone);
  const advanceSlaJobs = registerAdvanceTasksSlaJobs(supabase, timezone);
  const queueSlaJobs = registerQueueSlaJobs(supabase, timezone);
  const driverDocJobs = registerDriverDocumentExpiryJobs(supabase, timezone);
  const signatureSyncJobs = registerSignatureSyncJobs(supabase, timezone);
  const signatureDeadlineJobs = registerSignatureDeadlineJobs(supabase, timezone);
  const fluxDriverSyncJobs = registerFluxDriverSyncJobs(supabase, timezone);
  const fluxDeliverySyncJobs = registerFluxDeliverySyncJobs(supabase, timezone);
  const commercialLeadScoringJobs = registerCommercialLeadScoringJobs(supabase, timezone);
  const orchestratorNightModeJobs = registerOrchestratorNightModeJobs(timezone);
  const automation = createAutomationEngine(supabase, pubsub);

  const fluxDriverSyncCron = process.env.FLUX_DRIVER_SYNC_CRON?.trim() || '0 */6 * * *';
  const fluxDeliverySyncCron = process.env.FLUX_DELIVERY_SYNC_CRON?.trim() || '30 6 * * *';
  const commercialScoringCron = process.env.COMMERCIAL_LEAD_SCORING_CRON?.trim() || '*/30 * * * *';
  const orchestratorNightOffCron = process.env.ORCHESTRATOR_NIGHT_OFF_CRON?.trim() || '0 22 * * *';
  const orchestratorNightWarmupCron = process.env.ORCHESTRATOR_NIGHT_WARMUP_CRON?.trim() || '55 5 * * *';
  const orchestratorNightOnCron = process.env.ORCHESTRATOR_NIGHT_ON_CRON?.trim() || '0 6 * * *';

  const runFinancialOverdue: JobHandler = async () => {
    console.log('[Job] Atualizando parcelas vencidas...');
    const today = new Date().toISOString().split('T')[0];
    const { error } = await supabase
      .from('financial_installments')
      .update({ status: 'overdue' })
      .eq('status', 'pending')
      .lt('due_date', today);
    if (error) throw error;
    console.log('[Job] Parcelas vencidas atualizadas.');
  };

  const runInstallmentWeekly: JobHandler = async () => {
    console.log('[Job] Disparando avisos de desconto semanal...');
    const weekStart = new Date();
    const weekEnd = new Date();
    weekEnd.setDate(weekEnd.getDate() + 6);

    const { data: installments } = await supabase
      .from('financial_installments')
      .select(`
        id, amount, due_date, reference,
        financial_entries(type, drivers(id, name, phone))
      `)
      .eq('status', 'pending')
      .eq('financial_entries.status', 'active')
      .gte('due_date', weekStart.toISOString().split('T')[0])
      .lte('due_date', weekEnd.toISOString().split('T')[0]);

    if (!installments?.length) {
      console.log('[Job] Nenhuma parcela esta semana.');
      return;
    }

    await automation.triggerAutomation('installment_due_weekly', { installments });
  };

  const runConversationSla: JobHandler = async () => {
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
  };

  const runTickMinute: JobHandler = async () => {
    await advanceSlaJobs.runAdvanceSlaJob();
    await queueSlaJobs.runQueueSlaJob();
  };

  const runTick2Min: JobHandler = async () => {
    await runConversationSla();
    await ticketSlaJobs.runAlert80Job();
    await ticketSlaJobs.runEscalationJob();
  };

  const runTick5Min: JobHandler = async () => {
    await automation.runScheduledAutomationRules();
  };

  const runWebhookCleanup: JobHandler = async () => {
    const cutoff = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
    const { error } = await supabase.from('processed_webhook_events').delete().lt('processed_at', cutoff);
    if (error) throw error;
    console.log('[Job] Eventos antigos de webhook removidos.');
  };

  const runFluxDriverSync: JobHandler = async () => {
    if (process.env.FLUX_DRIVER_SYNC_ENABLED === 'false') return;
    console.log('[Job] Sincronizando entregadores Flux Delivery...');
    const result = await fluxDriverSyncJobs.runFluxDriverSyncJob();
    if (!result) {
      console.log('[Job] Flux driver sync ignorado.');
      return;
    }
    if (result.error) throw new Error(result.error);
    console.log(`[Job] Flux driver sync: criados=${result.created} atualizados=${result.updated}`);
  };

  const runFluxDeliverySync: JobHandler = async () => {
    if (process.env.FLUX_DELIVERY_SYNC_ENABLED === 'false') return;
    console.log('[Job] Sincronizando entregas Flux → billing...');
    const result = await fluxDeliverySyncJobs.runFluxDeliverySyncJob();
    if (!result) {
      console.log('[Job] Flux delivery sync ignorado.');
      return;
    }
    console.log(`[Job] Flux delivery sync: importadas=${result.imported}`);
  };

  const runCommercialScoring: JobHandler = async () => {
    if (process.env.COMMERCIAL_LEAD_SCORING_ENABLED === 'false') return;
    console.log('[Job] Rescore comercial de leads...');
    const result = await commercialLeadScoringJobs.runCommercialLeadScoringBatch();
    console.log(`[Job] Commercial lead scoring: ${result?.processed ?? 0} lead(s).`);
  };

  const runCoraStatementSync: JobHandler = async () => {
    if (process.env.BILLING_CORA_STATEMENT_SYNC_ENABLED === 'false') {
      console.log('[Job] Cora statement sync pausado (BILLING_CORA_STATEMENT_SYNC_ENABLED=false).');
      return;
    }
    console.log('[Job] Sync extrato/saldo Cora (via api-service)...');
    const result = await runCoraStatementSyncViaApi();
    if (result.skipped) {
      console.log(`[Job] Cora statement sync ignorado: ${result.skipped}`);
      return;
    }
    if (!result.ok) {
      throw new Error(result.error || `Cora sync falhou HTTP ${result.status}`);
    }
    console.log('[Job] Cora statement sync OK', JSON.stringify(result.body).slice(0, 500));
  };

  const handlers: Record<string, JobHandler> = {
    'tick-minute': runTickMinute,
    'tick-2min': runTick2Min,
    'tick-5min': runTick5Min,
    'financial-overdue': runFinancialOverdue,
    'installment-weekly': runInstallmentWeekly,
    'webhook-cleanup': runWebhookCleanup,
    'tickets-daily-report': async () => ticketSlaJobs.runDailyReportJob(),
    'driver-doc-expiry': async () => {
      const result = await driverDocJobs.runDriverDocumentExpiryJob();
      console.log(`[Job] Documentos: ${result?.processed ?? 0} processado(s).`);
    },
    'signature-sync': async () => {
      if (process.env.AUTENTIQUE_SYNC_ENABLED === 'false') {
        console.log('[Job] Autentique sync pausado (AUTENTIQUE_SYNC_ENABLED=false).');
        return;
      }
      const result = await signatureSyncJobs.runSignatureSyncJob();
      console.log(`[Job] Autentique sync: ${result?.synced ?? 0} atualização(ões).`);
    },
    'signature-deadline': async () => {
      const result = await signatureDeadlineJobs.runSignatureDeadlineJob();
      console.log(`[Job] Assinaturas em atraso: ${result?.notified ?? 0}.`);
    },
    'flux-driver-sync': runFluxDriverSync,
    'flux-delivery-sync': runFluxDeliverySync,
    'commercial-scoring': runCommercialScoring,
    'cora-statement-sync': runCoraStatementSync,
    'orchestrator-night-off': async () => orchestratorNightModeJobs.scaleOff(),
    'orchestrator-night-warmup': async () => orchestratorNightModeJobs.warmup(),
    'orchestrator-night-on': async () => orchestratorNightModeJobs.scaleOn(),
  };

  const catalog: JobCatalogEntry[] = [
    { name: 'tick-minute', description: 'SLA adiantamento + queue_sla', schedule: '* * * * *' },
    { name: 'tick-2min', description: 'SLA conversas + tickets', schedule: '*/2 * * * *' },
    { name: 'tick-5min', description: 'Automações schedule', schedule: '*/5 * * * *' },
    { name: 'financial-overdue', description: 'Parcelas vencidas', schedule: '5 0 * * *' },
    { name: 'installment-weekly', description: 'Aviso desconto semanal', schedule: '0 8 * * 1' },
    { name: 'webhook-cleanup', description: 'Limpeza processed_webhook_events', schedule: '0 3 * * 0' },
    { name: 'tickets-daily-report', description: 'Relatório diário tickets', schedule: '0 18 * * *' },
    { name: 'driver-doc-expiry', description: 'CNH/certificado entregadores', schedule: '15 6 * * *' },
    { name: 'signature-sync', description: 'Sync Autentique', schedule: '*/15 * * * *' },
    { name: 'signature-deadline', description: 'Prazo assinatura', schedule: '30 7 * * *' },
    { name: 'flux-driver-sync', description: 'Sync entregadores Flux', schedule: fluxDriverSyncCron },
    { name: 'flux-delivery-sync', description: 'Sync entregas Flux billing', schedule: fluxDeliverySyncCron },
    { name: 'commercial-scoring', description: 'Rescore leads comerciais', schedule: commercialScoringCron },
    {
      name: 'cora-statement-sync',
      description: 'Extrato + saldo Cora (Flux)',
      schedule: '0 18 * * 1-5',
    },
    { name: 'orchestrator-night-off', description: 'Orchestrator min=0', schedule: orchestratorNightOffCron },
    { name: 'orchestrator-night-warmup', description: 'Warmup orchestrator', schedule: orchestratorNightWarmupCron },
    { name: 'orchestrator-night-on', description: 'Orchestrator min=1', schedule: orchestratorNightOnCron },
  ];

  async function runJob(name: string) {
    const handler = handlers[name];
    if (!handler) return { ok: false, error: `job desconhecido: ${name}` };
    try {
      await handler();
      return { ok: true };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[Job] Erro em ${name}:`, err);
      return { ok: false, error: message };
    }
  }

  function registerCrons() {
    const tasks: ScheduledTask[] = [];
    const opts = { timezone };

    tasks.push(cron.schedule('5 0 * * *', () => runJob('financial-overdue'), opts));
    tasks.push(cron.schedule('0 8 * * 1', () => runJob('installment-weekly'), opts));
    tasks.push(cron.schedule('*/5 * * * *', () => runJob('tick-5min'), opts));
    tasks.push(cron.schedule('*/2 * * * *', () => runJob('tick-2min'), opts));
    tasks.push(cron.schedule('* * * * *', () => runJob('tick-minute'), opts));
    tasks.push(cron.schedule('0 18 * * *', () => runJob('tickets-daily-report'), opts));
    tasks.push(cron.schedule('15 6 * * *', () => runJob('driver-doc-expiry'), opts));
    if (process.env.AUTENTIQUE_SYNC_ENABLED !== 'false') {
      tasks.push(cron.schedule('*/15 * * * *', () => runJob('signature-sync'), opts));
    }
    tasks.push(cron.schedule('30 7 * * *', () => runJob('signature-deadline'), opts));
    tasks.push(cron.schedule('0 3 * * 0', () => runJob('webhook-cleanup'), opts));

    if (process.env.FLUX_DRIVER_SYNC_ENABLED !== 'false') {
      tasks.push(cron.schedule(fluxDriverSyncCron, () => runJob('flux-driver-sync'), opts));
    }
    if (process.env.FLUX_DELIVERY_SYNC_ENABLED !== 'false') {
      tasks.push(cron.schedule(fluxDeliverySyncCron, () => runJob('flux-delivery-sync'), opts));
    }
    if (process.env.COMMERCIAL_LEAD_SCORING_ENABLED !== 'false') {
      tasks.push(cron.schedule(commercialScoringCron, () => runJob('commercial-scoring'), opts));
    }
    if (process.env.BILLING_CORA_STATEMENT_SYNC_ENABLED !== 'false') {
      tasks.push(cron.schedule('0 18 * * 1-5', () => runJob('cora-statement-sync'), opts));
    }
    if (process.env.ORCHESTRATOR_NIGHT_MODE_ENABLED !== 'false') {
      tasks.push(cron.schedule(orchestratorNightOffCron, () => runJob('orchestrator-night-off'), opts));
      tasks.push(cron.schedule(orchestratorNightWarmupCron, () => runJob('orchestrator-night-warmup'), opts));
      tasks.push(cron.schedule(orchestratorNightOnCron, () => runJob('orchestrator-night-on'), opts));
    }

    return tasks;
  }

  return { timezone, handlers, catalog, registerCrons, runJob };
}

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  getFluxDeliveryClient,
  isFluxDeliverySkipped,
  linkNullDeliveriesToOpenCycles,
  loadFluxDeliveryConfig,
  resolveFluxSyncWorkspaceId,
  runFluxDeliverySyncForWorkspace,
  runFluxPharmacySyncForWorkspace,
} from '@plataforma/flux-delivery';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { writeAuditLog } from '../../lib/auditLog';
import {
  importMysqlReconcileRows,
  loadFluxMysqlConfig,
  publicMysqlReconcileReport,
  reconcileBillingWithFluxMysql,
  type MysqlImportStats,
} from '../../lib/billingFluxMysqlReconcile';
import {
  ingestExternalAppDeliveries,
  isBillingExternalAppEnabled,
  validateBillingExternalAppToken,
} from '../../lib/billingExternalAppConnector';

const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function ingestionError(source: string, err: unknown) {
  const raw = err instanceof Error ? err.message : 'Erro desconhecido';
  return {
    error: raw,
    operator_message: `${source}: a ingestão não foi concluída. Motivo técnico: ${raw}. Verifique as credenciais, o período informado e os cadastros de farmácias/entregadores antes de tentar novamente.`,
  };
}

function fluxPharmacyMessage(result: Record<string, unknown>, dryRun: boolean): string {
  const matched = Number(result.matched ?? 0);
  const updated = Number(result.updated ?? 0);
  const unmatchedFlux = Number(result.unmatched_flux ?? 0);
  const action = dryRun ? 'Simulação de farmácias Flux concluída' : 'Sincronização de farmácias Flux concluída';
  return `${action}: ${matched} farmácias encontradas por CNPJ, ${updated} vínculo(s) atualizado(s) e ${unmatchedFlux} farmácia(s) Flux sem cadastro local correspondente.`;
}

function fluxDeliveryMessage(result: Record<string, unknown>, dryRun: boolean): string {
  const total = Number(result.flux_total ?? 0);
  const imported = Number(result.imported ?? 0);
  const missingPharmacy = Number(result.skipped_unmapped_pharmacy ?? 0);
  const missingDriver = Number(result.skipped_unmapped_driver ?? 0);
  const invalid = Number(result.skipped_invalid ?? 0);
  const byCpf = Number(result.matched_by_cpf ?? 0);
  const byCatalogId = Number(result.matched_by_catalog_id ?? 0);
  const assigned = Number(result.assigned_to_cycle ?? 0);
  const action = dryRun ? 'Simulação de entregas Flux concluída' : 'Importação de entregas Flux concluída';
  const enrichBits = [
    byCatalogId > 0 ? `${byCatalogId} via catálogo Flux (id)` : null,
    byCpf > 0 ? `${byCpf} via CPF` : null,
  ].filter(Boolean);
  const enrich =
    enrichBits.length > 0 ? ` Match extra: ${enrichBits.join(', ')}.` : '';
  const cycleBit =
    !dryRun && assigned > 0 ? ` ${assigned} entrega(s) vinculada(s) ao ciclo de apuração em aberto.` : '';
  return `${action}: ${total} entrega(s) retornada(s), ${imported} gravada(s), ${missingPharmacy} ignorada(s) por farmácia sem vínculo, ${missingDriver} por entregador sem cadastro e ${invalid} por dados inválidos.${enrich}${cycleBit}`;
}

function mysqlReconcileMessage(
  report: {
    missing_in_aethera_count?: number;
    missing_in_mysql_count?: number;
    missing_in_aethera?: unknown[];
    missing_in_mysql?: unknown[];
    mysql_total?: number;
    aethera_flux_db_total?: number;
  },
  importStats: MysqlImportStats
): string {
  const missingAethera =
    report.missing_in_aethera_count ?? (report.missing_in_aethera || []).length;
  const missingMysql =
    report.missing_in_mysql_count ?? (report.missing_in_mysql || []).length;
  const aetheraTotal = Number(report.aethera_flux_db_total ?? 0);
  const parts = [
    `Reconciliação MySQL concluída: ${Number(report.mysql_total ?? 0)} entrega(s) lida(s) no MySQL`,
    `${aetheraTotal} já no Aethera (flux_api/flux_db)`,
    `${missingAethera} ainda ausente(s) no Aethera`,
    `${missingMysql} registro(s) do Aethera não encontrado(s) no MySQL`,
    `${importStats.imported} entrega(s) importada(s)`,
  ];
  const skipBits = [
    importStats.skipped_unmapped_pharmacy > 0
      ? `${importStats.skipped_unmapped_pharmacy} sem farmácia vinculada`
      : null,
    importStats.skipped_unmapped_driver > 0
      ? `${importStats.skipped_unmapped_driver} sem entregador mapeado`
      : null,
    importStats.skipped_missing_driver_name > 0
      ? `${importStats.skipped_missing_driver_name} sem nome de entregador no MySQL`
      : null,
    importStats.skipped_duplicate > 0
      ? `${importStats.skipped_duplicate} já existentes (duplicata)`
      : null,
  ].filter(Boolean);
  const skip =
    skipBits.length > 0 ? ` Pendências de importação: ${skipBits.join(', ')}.` : '';
  return `${parts.join(', ')}.${skip}`;
}

export async function registerBillingIntegrationRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/integrations/flux/status', { preHandler: [...preView] }, async (_request, reply) => {
    const cfg = loadFluxDeliveryConfig();
    const mysql = loadFluxMysqlConfig();
    return reply.send({
      flux_api_configured: Boolean(cfg) && !isFluxDeliverySkipped(),
      flux_api_skipped: isFluxDeliverySkipped(),
      mysql_configured: Boolean(mysql),
      external_app_enabled: isBillingExternalAppEnabled(),
    });
  });

  app.post('/integrations/flux/sync-pharmacies', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const body = z
      .object({ dry_run: z.boolean().default(false), force: z.boolean().default(false) })
      .safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos' });

    const fluxClient = getFluxDeliveryClient();
    if (!fluxClient) {
      return reply.status(503).send({ error: 'Flux API não configurada (FLUX_DELIVERY_* ou FLUX_DELIVERY_SKIP)' });
    }

    try {
      const result = await runFluxPharmacySyncForWorkspace(supabase, {
        workspaceId,
        fluxClient,
        dryRun: body.data.dry_run,
        forceOverwrite: body.data.force,
      });

      if (!body.data.dry_run) {
        await writeAuditLog({
          actor_id: (request.user as { sub: string }).sub,
          action: 'billing.flux.sync_pharmacies',
          entity_type: 'workspace',
          entity_id: workspaceId,
          metadata: result,
        });
      }

      return reply.send({ result, operator_message: fluxPharmacyMessage(result as Record<string, unknown>, body.data.dry_run) });
    } catch (err) {
      return reply.status(500).send(ingestionError('Farmácias Flux', err));
    }
  });

  app.post('/integrations/flux/sync-deliveries', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const body = z
      .object({
        data_inicio: dateSchema,
        data_fim: dateSchema,
        dry_run: z.boolean().default(false),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'data_inicio e data_fim obrigatórios (YYYY-MM-DD)' });

    const fluxClient = getFluxDeliveryClient();
    if (!fluxClient) {
      return reply.status(503).send({ error: 'Flux API não configurada' });
    }

    try {
      const result = await runFluxDeliverySyncForWorkspace(supabase, {
        workspaceId,
        fluxClient,
        dataInicio: body.data.data_inicio,
        dataFim: body.data.data_fim,
        dryRun: body.data.dry_run,
      });

      if (!body.data.dry_run) {
        await writeAuditLog({
          actor_id: (request.user as { sub: string }).sub,
          action: 'billing.flux.sync_deliveries',
          entity_type: 'workspace',
          entity_id: workspaceId,
          metadata: result,
        });
      }

      return reply.send({ result, operator_message: fluxDeliveryMessage(result as Record<string, unknown>, body.data.dry_run) });
    } catch (err) {
      return reply.status(500).send(ingestionError('Entregas da API Flux', err));
    }
  });

  app.post('/integrations/flux/reconcile-mysql', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const body = z
      .object({
        data_inicio: dateSchema,
        data_fim: dateSchema,
        import_missing: z.boolean().default(false),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'data_inicio e data_fim obrigatórios' });

    try {
      const report = await reconcileBillingWithFluxMysql(
        supabase,
        workspaceId,
        body.data.data_inicio,
        body.data.data_fim
      );

      const importStats: MysqlImportStats = {
        imported: 0,
        skipped_unmapped_pharmacy: 0,
        skipped_unmapped_driver: 0,
        skipped_missing_driver_name: 0,
        skipped_duplicate: 0,
      };
      let assigned_to_cycle = 0;
      const toImport = report._missing_in_aethera_all || report.missing_in_aethera;
      if (body.data.import_missing && toImport.length) {
        const res = await importMysqlReconcileRows(supabase, workspaceId, toImport);
        Object.assign(importStats, res);
      }
      try {
        assigned_to_cycle = await linkNullDeliveriesToOpenCycles(
          supabase,
          workspaceId,
          body.data.data_inicio,
          body.data.data_fim
        );
      } catch {
        assigned_to_cycle = 0;
      }

      const pub = publicMysqlReconcileReport(report);
      // Após import bem-sucedido, as importadas deixam de estar "ausentes".
      if (importStats.imported > 0) {
        pub.missing_in_aethera_count = Math.max(0, pub.missing_in_aethera_count - importStats.imported);
        pub.aethera_flux_db_total += importStats.imported;
        pub.missing_in_aethera = pub.missing_in_aethera.slice(
          0,
          Math.min(pub.missing_in_aethera.length, pub.missing_in_aethera_count)
        );
      }

      return reply.send({
        report: pub,
        imported: importStats.imported,
        import_stats: importStats,
        assigned_to_cycle,
        operator_message: mysqlReconcileMessage(pub, importStats),
      });
    } catch (err) {
      return reply.status(500).send(ingestionError('Entregas do MySQL Flux', err));
    }
  });

  app.post('/integrations/external/deliveries', async (request, reply) => {
    if (!isBillingExternalAppEnabled()) {
      return reply.status(503).send({ error: 'Conector app externo desabilitado (BILLING_EXTERNAL_APP_TOKEN)' });
    }

    const token = String(request.headers['x-billing-app-token'] || '');
    if (!validateBillingExternalAppToken(token)) {
      return reply.status(401).send({ error: 'Token inválido' });
    }

    const workspaceId = String((request.body as { workspace_id?: string })?.workspace_id || process.env.BILLING_EXTERNAL_APP_WORKSPACE_ID || '');
    if (!workspaceId) {
      return reply.status(400).send({ error: 'workspace_id obrigatório' });
    }

    const body = z
      .object({
        workspace_id: z.string().uuid().optional(),
        deliveries: z
          .array(
            z.object({
              pharmacy_id: z.string().uuid(),
              driver_id: z.string().uuid(),
              delivered_at: z.string().min(10),
              external_id: z.string().min(1).max(120),
              document_number: z.string().max(64).optional().nullable(),
              route_id: z.string().max(64).optional().nullable(),
              cancelled: z.boolean().optional(),
            })
          )
          .min(1)
          .max(500),
      })
      .safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Payload inválido', details: body.error.flatten() });

    try {
      const result = await ingestExternalAppDeliveries(workspaceId, body.data.deliveries);
      return reply.send({
        ...result,
        operator_message: `Conector externo: ${Number((result as { imported?: number }).imported ?? 0)} entrega(s) recebida(s) e gravada(s) no financeiro.`,
      });
    } catch (err) {
      return reply.status(500).send(ingestionError('Conector externo de entregas', err));
    }
  });
}

export async function resolveBillingFluxWorkspaceId(): Promise<string | null> {
  return resolveFluxSyncWorkspaceId(supabase);
}

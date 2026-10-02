import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { linkNullDeliveriesToOpenCycles } from '@plataforma/flux-delivery';
import { supabase } from '../../lib/supabase';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace } from '../../lib/workspaceContext';
import { parseAtivmobReportFromBuffer } from '../../lib/billingAtivmobImport';

const deliveredAtSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}/));

const deliveryBodySchema = z.object({
  pharmacy_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  /** Optional for manual launches; defaults to now when omitted/empty. */
  delivered_at: z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? undefined : v),
    deliveredAtSchema.optional()
  ),
  document_number: z.string().max(64).optional().nullable(),
  route_id: z.string().max(64).optional().nullable(),
  source: z.enum(['flux_api', 'flux_db', 'manual', 'csv', 'external_app']).default('manual'),
  external_id: z.string().max(120).optional(),
  flux_codpes: z.number().int().optional().nullable(),
  flux_codloc: z.number().int().optional().nullable(),
  cancelled: z.boolean().default(false),
  verified: z.boolean().default(true),
  billing_cycle_id: z.string().uuid().optional().nullable(),
  /** Create N rows in one request (manual bulk). Default 1, max 500. */
  quantity: z.coerce.number().int().min(1).max(500).optional().default(1),
});

const DELIVERY_SOURCES = ['flux_api', 'flux_db', 'manual', 'csv', 'external_app'] as const;

type DeliveryListFilters = {
  cycle_id?: string;
  pharmacy_id?: string;
  driver_id?: string;
  from?: string;
  to?: string;
};

function applyDeliveryListFilters(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
  workspaceId: string,
  filters: DeliveryListFilters
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  let q = query.eq('workspace_id', workspaceId);
  if (filters.cycle_id) q = q.eq('billing_cycle_id', filters.cycle_id);
  if (filters.pharmacy_id) q = q.eq('pharmacy_id', filters.pharmacy_id);
  if (filters.driver_id) q = q.eq('driver_id', filters.driver_id);
  if (filters.from) q = q.gte('delivered_at', `${filters.from.slice(0, 10)}T00:00:00.000Z`);
  if (filters.to) q = q.lte('delivered_at', `${filters.to.slice(0, 10)}T23:59:59.999Z`);
  return q;
}

/** Totais do mesmo filtro da listagem (não da página atual). */
async function loadDeliveryKpiSummary(workspaceId: string, filters: DeliveryListFilters) {
  const by_source: Record<string, number> = {};
  for (const source of DELIVERY_SOURCES) by_source[source] = 0;

  const countVerifiedBySource = async (source: (typeof DELIVERY_SOURCES)[number]) => {
    // Explicit any avoids TS2589 (excessively deep instantiation) on Supabase filter chains.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let q: any = supabase
      .from('billing_delivery_records')
      .select('id', { count: 'exact', head: true })
      .eq('cancelled', false)
      .eq('verified', true)
      .eq('source', source);
    q = applyDeliveryListFilters(q, workspaceId, filters);
    const { count, error } = await q;
    if (error) throw new Error(error.message);
    return count || 0;
  };

  const counts = await Promise.all(DELIVERY_SOURCES.map((s) => countVerifiedBySource(s)));
  let verified_total = 0;
  DELIVERY_SOURCES.forEach((source, i) => {
    by_source[source] = counts[i];
    verified_total += counts[i];
  });

  return { verified_total, by_source };
}

const csvRowSchema = z.object({
  pharmacy_id: z.string().uuid(),
  driver_id: z.string().uuid(),
  delivered_at: z.string().min(10),
  document_number: z.string().optional(),
  route_id: z.string().optional(),
});

function parseDeliveredAt(value: string): string {
  if (value.includes('T')) return new Date(value).toISOString();
  return new Date(`${value.slice(0, 10)}T12:00:00.000Z`).toISOString();
}

/** Resolve delivered_at for insert; empty/missing → now (DB column is NOT NULL). */
function resolveDeliveredAt(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return new Date().toISOString();
  return parseDeliveredAt(trimmed);
}

/**
 * Unique key for (workspace_id, source, external_id).
 * Manual creates always get a fresh id so the same pharmacy+driver can have many manuals
 * even when document/route/datetime are empty (avoids ON CONFLICT collisions).
 */
function resolveManualExternalId(): string {
  return `manual:${randomUUID()}`;
}

function normalizeCnpjDigits(value: unknown): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (digits.length === 13) return digits.padStart(14, '0');
  return digits;
}

const ATIVMOB_UPSERT_CHUNK = 200;

/** Conflict key for billing_delivery_records unique (workspace_id, source, external_id). */
function deliveryConflictKey(row: Record<string, unknown>): string {
  return `${row.workspace_id}|${row.source}|${row.external_id}`;
}

/**
 * Postgres rejects INSERT ... ON CONFLICT DO UPDATE when the same conflict row
 * appears twice in one statement. Keep the last row per conflict key.
 */
function dedupeDeliveryUpsertsByConflictKey(rows: Record<string, unknown>[]): {
  unique: Record<string, unknown>[];
  duplicatesCollapsed: number;
} {
  const byKey = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    byKey.set(deliveryConflictKey(row), row);
  }
  const unique = [...byKey.values()];
  return { unique, duplicatesCollapsed: Math.max(0, rows.length - unique.length) };
}

function ativmobOperatorMessage(input: {
  imported: number;
  deliveredRows: number;
  unmappedCount: number;
  duplicatesCollapsed?: number;
  topUnmapped?: { type: string; value: string; count: number }[];
}): string {
  if (input.imported > 0) {
    const pending =
      input.unmappedCount > 0
        ? ` Ficaram ${input.unmappedCount} entrega(s) sem importação por falta de cadastro ou mapeamento.`
        : ' Não há pendências de mapeamento.';
    const collapsed =
      (input.duplicatesCollapsed || 0) > 0
        ? ` ${input.duplicatesCollapsed} linha(s) duplicada(s) na planilha foram unificadas (mesma chave de entrega; manteve-se a última ocorrência).`
        : '';
    return `Planilha ATIVMOB processada: ${input.imported} entrega(s) gravada(s) de ${input.deliveredRows} linha(s) entregues.${collapsed}${pending}`;
  }

  const top = (input.topUnmapped || [])
    .slice(0, 3)
    .map((item) => `${item.type} ${item.value} (${item.count} ocorrência(s))`)
    .join('; ');
  return top
    ? `Nenhuma entrega da planilha ATIVMOB foi gravada. Principais pendências: ${top}. Cadastre ou corrija esses vínculos e tente novamente.`
    : 'Nenhuma entrega da planilha ATIVMOB foi gravada. Confira se o arquivo contém entregas finalizadas e colunas obrigatórias.';
}

export async function registerBillingDeliveryRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/deliveries', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const q = request.query as {
      cycle_id?: string;
      pharmacy_id?: string;
      driver_id?: string;
      from?: string;
      to?: string;
      limit?: string;
      page?: string;
    };
    const limit = Math.min(50, Math.max(1, Number(q.limit) || 50));
    const page = Math.max(1, Number(q.page) || 1);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const filters: DeliveryListFilters = {
      cycle_id: q.cycle_id,
      pharmacy_id: q.pharmacy_id,
      driver_id: q.driver_id,
      from: q.from,
      to: q.to,
    };

    let query = supabase
      .from('billing_delivery_records')
      .select(
        '*, pharmacies(id, trade_name, legal_name), drivers(id, name)',
        { count: 'exact' }
      )
      .order('delivered_at', { ascending: false })
      .range(from, to);
    query = applyDeliveryListFilters(query, workspaceId, filters);

    const [{ data, error, count }, summary] = await Promise.all([
      query,
      loadDeliveryKpiSummary(workspaceId, filters),
    ]);
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({
      deliveries: data || [],
      page,
      limit,
      total: count || 0,
      total_pages: Math.max(1, Math.ceil((count || 0) / limit)),
      summary: {
        verified_total: summary.verified_total,
        by_source: summary.by_source,
      },
    });
  });

  app.post('/deliveries', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = deliveryBodySchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const source = parsed.data.source;
    const quantity = parsed.data.quantity ?? 1;
    const now = new Date().toISOString();
    const deliveredAt = resolveDeliveredAt(parsed.data.delivered_at);
    const documentNumber = parsed.data.document_number?.trim() || null;
    const routeId = parsed.data.route_id?.trim() || null;
    const baseRow = {
      workspace_id: workspaceId,
      pharmacy_id: parsed.data.pharmacy_id,
      driver_id: parsed.data.driver_id,
      delivered_at: deliveredAt,
      document_number: documentNumber,
      route_id: routeId,
      source,
      flux_codpes: parsed.data.flux_codpes ?? null,
      flux_codloc: parsed.data.flux_codloc ?? null,
      cancelled: parsed.data.cancelled,
      verified: parsed.data.verified,
      billing_cycle_id: parsed.data.billing_cycle_id || null,
      updated_at: now,
    };

    const rows = Array.from({ length: quantity }, (_, index) => {
      const externalId =
        source === 'manual'
          ? resolveManualExternalId()
          : quantity === 1 && parsed.data.external_id?.trim()
            ? parsed.data.external_id.trim()
            : `${source}:${randomUUID()}`;
      // Same timestamp for all when datetime omitted; if provided, all share it.
      // Slight offset only when quantity>1 and no explicit datetime, to keep ordering stable.
      const rowDeliveredAt =
        quantity > 1 && !String(parsed.data.delivered_at ?? '').trim()
          ? new Date(Date.parse(deliveredAt) + index).toISOString()
          : deliveredAt;
      return { ...baseRow, delivered_at: rowDeliveredAt, external_id: externalId };
    });

    const { data, error } = await supabase
      .from('billing_delivery_records')
      .insert(rows)
      .select('*, pharmacies(id, trade_name, legal_name), drivers(id, name)');

    if (error) {
      if (String(error.message).includes('billing_delivery_records_workspace_source_external')) {
        return reply.status(409).send({ error: 'Entrega duplicada (source + external_id).' });
      }
      return reply.status(500).send({ error: error.message });
    }

    const deliveries = data || [];
    return reply.status(201).send({
      delivery: deliveries[0] || null,
      deliveries,
      created: deliveries.length,
    });
  });

  app.patch('/deliveries/:id', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const parsed = deliveryBodySchema.partial().safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (parsed.data.pharmacy_id !== undefined) patch.pharmacy_id = parsed.data.pharmacy_id;
    if (parsed.data.driver_id !== undefined) patch.driver_id = parsed.data.driver_id;
    if (parsed.data.delivered_at !== undefined) patch.delivered_at = resolveDeliveredAt(parsed.data.delivered_at);
    if (parsed.data.document_number !== undefined) patch.document_number = parsed.data.document_number?.trim() || null;
    if (parsed.data.route_id !== undefined) patch.route_id = parsed.data.route_id?.trim() || null;
    if (parsed.data.cancelled !== undefined) patch.cancelled = parsed.data.cancelled;
    if (parsed.data.verified !== undefined) patch.verified = parsed.data.verified;
    if (parsed.data.billing_cycle_id !== undefined) patch.billing_cycle_id = parsed.data.billing_cycle_id;

    const { data, error } = await supabase
      .from('billing_delivery_records')
      .update(patch)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .select('*, pharmacies(id, trade_name, legal_name), drivers(id, name)')
      .maybeSingle();
    if (error) return reply.status(500).send({ error: error.message });
    if (!data) return reply.status(404).send({ error: 'Entrega não encontrada' });
    return reply.send({ delivery: data });
  });

  app.post('/deliveries/import-csv', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const body = request.body as { rows?: unknown[] };
    if (!Array.isArray(body.rows) || !body.rows.length) {
      return reply.status(400).send({ error: 'Envie { rows: [...] } com ao menos uma linha.' });
    }

    const now = new Date().toISOString();
    const inserts: Record<string, unknown>[] = [];
    const errors: { index: number; message: string }[] = [];

    body.rows.forEach((raw, index) => {
      const parsed = csvRowSchema.safeParse(raw);
      if (!parsed.success) {
        errors.push({ index, message: 'Linha inválida' });
        return;
      }
      inserts.push({
        workspace_id: workspaceId,
        pharmacy_id: parsed.data.pharmacy_id,
        driver_id: parsed.data.driver_id,
        delivered_at: parseDeliveredAt(parsed.data.delivered_at),
        document_number: parsed.data.document_number?.trim() || null,
        route_id: parsed.data.route_id?.trim() || null,
        source: 'csv',
        external_id: `csv:${parsed.data.pharmacy_id}:${parsed.data.driver_id}:${parsed.data.delivered_at}:${parsed.data.document_number || index}`,
        cancelled: false,
        verified: true,
        updated_at: now,
      });
    });

    if (!inserts.length) return reply.status(400).send({ error: 'Nenhuma linha válida', errors });

    const { data, error } = await supabase
      .from('billing_delivery_records')
      .upsert(inserts, { onConflict: 'workspace_id,source,external_id', ignoreDuplicates: true })
      .select('id');
    if (error) return reply.status(500).send({ error: error.message });

    return reply.send({ imported: (data || []).length, skipped_errors: errors });
  });

  app.post('/deliveries/import-ativmob', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;

    const body = request.body as { file_base64?: string; billing_cycle_id?: string | null };
    const b64 = body.file_base64?.trim();
    if (!b64) {
      return reply.status(400).send({ error: 'Envie { file_base64: "..." } com o XLSX do relatório ATIVMOB.' });
    }

    let parsed;
    try {
      parsed = await parseAtivmobReportFromBuffer(Buffer.from(b64, 'base64'));
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Falha ao ler relatório ATIVMOB';
      return reply.status(400).send({
        error: reason,
        operator_message: `Não foi possível ler a planilha ATIVMOB. Motivo: ${reason}. Verifique se o arquivo é .xlsx e se está no layout esperado.`,
      });
    }

    const [{ data: pharmacies }, { data: drivers }] = await Promise.all([
      supabase.from('pharmacies').select('id, cnpj').eq('workspace_id', workspaceId),
      supabase.from('drivers').select('id, name, flux_delivery_driver_id').eq('workspace_id', workspaceId),
    ]);

    const pharmacyByCnpj = new Map<string, string>();
    for (const p of pharmacies || []) {
      const digits = normalizeCnpjDigits(p.cnpj);
      if (digits) pharmacyByCnpj.set(digits, String(p.id));
    }

    const normalizeName = (value: string) =>
      value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toUpperCase()
        .replace(/\s+/g, ' ')
        .trim();

    const driverByName = new Map<string, string>();
    for (const d of drivers || []) {
      driverByName.set(normalizeName(String(d.name || '')), String(d.id));
      if (d.flux_delivery_driver_id) {
        driverByName.set(normalizeName(String(d.flux_delivery_driver_id)), String(d.id));
      }
    }

    const now = new Date().toISOString();
    const inserts: Record<string, unknown>[] = [];
    const unmapped: { type: string; value: string }[] = [];
    const unmappedSummaryMap = new Map<string, { type: string; value: string; count: number }>();
    const pushUnmapped = (type: string, value: string) => {
      const key = `${type}:${value}`;
      const current = unmappedSummaryMap.get(key);
      if (current) {
        current.count += 1;
        return;
      }
      const item = { type, value, count: 1 };
      unmappedSummaryMap.set(key, item);
      unmapped.push({ type, value });
    };

    for (const row of parsed.deliveries) {
      const pharmacyId = pharmacyByCnpj.get(row.pharmacy_cnpj);
      const driverId = driverByName.get(normalizeName(row.driver_name));
      if (!pharmacyId) {
        pushUnmapped('pharmacy_cnpj', row.pharmacy_cnpj);
        continue;
      }
      if (!driverId) {
        pushUnmapped('driver_name', row.driver_name);
        continue;
      }
      inserts.push({
        workspace_id: workspaceId,
        pharmacy_id: pharmacyId,
        driver_id: driverId,
        delivered_at: row.delivered_at,
        document_number: row.document_number,
        route_id: row.route_id,
        source: 'external_app',
        external_id: row.external_id,
        cancelled: row.cancelled,
        verified: true,
        billing_cycle_id: body.billing_cycle_id || null,
        updated_at: now,
      });
    }

    if (!inserts.length) {
      const error =
        parsed.deliveries.length === 0
          ? 'Nenhuma entrega entregue encontrada na planilha ATIVMOB.'
          : 'Nenhuma entrega mapeada (farmácia/entregador).';
      const unmappedSummaryRows = [...unmappedSummaryMap.values()].sort((a, b) => b.count - a.count).slice(0, 50);
      return reply.status(400).send({
        error,
        operator_message: ativmobOperatorMessage({
          imported: 0,
          deliveredRows: parsed.stats.delivered_rows,
          unmappedCount: unmappedSummaryRows.reduce((sum, item) => sum + item.count, 0),
          topUnmapped: unmappedSummaryRows,
        }),
        report: parsed.meta,
        stats: parsed.stats,
        unmapped_count: unmappedSummaryRows.reduce((sum, item) => sum + item.count, 0),
        unmapped_sample: unmapped.slice(0, 20),
        unmapped_summary: unmappedSummaryRows,
      });
    }

    const { unique: uniqueInserts, duplicatesCollapsed } = dedupeDeliveryUpsertsByConflictKey(inserts);

    const upsertedIds: string[] = [];
    for (let i = 0; i < uniqueInserts.length; i += ATIVMOB_UPSERT_CHUNK) {
      const chunk = uniqueInserts.slice(i, i + ATIVMOB_UPSERT_CHUNK);
      const { data, error } = await supabase
        .from('billing_delivery_records')
        .upsert(chunk, { onConflict: 'workspace_id,source,external_id', ignoreDuplicates: false })
        .select('id');
      if (error) {
        return reply.status(500).send({
          error: error.message,
          operator_message: `A planilha ATIVMOB foi lida, mas as entregas não foram gravadas no banco. Motivo técnico: ${error.message}.`,
          duplicates_collapsed: duplicatesCollapsed,
        });
      }
      for (const row of data || []) {
        if (row?.id) upsertedIds.push(String(row.id));
      }
    }

    let assignedToCycle = 0;
    if (!body.billing_cycle_id) {
      const dates = uniqueInserts
        .map((row) => String(row.delivered_at || '').slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
        .sort();
      if (dates.length) {
        try {
          assignedToCycle = await linkNullDeliveriesToOpenCycles(
            supabase,
            workspaceId,
            dates[0],
            dates[dates.length - 1]
          );
        } catch {
          assignedToCycle = 0;
        }
      }
    }

    const unmappedSummaryRows = [...unmappedSummaryMap.values()].sort((a, b) => b.count - a.count).slice(0, 50);
    const unmappedCount = unmappedSummaryRows.reduce((sum, item) => sum + item.count, 0);
    const imported = upsertedIds.length;

    return reply.send({
      imported,
      assigned_to_cycle: assignedToCycle,
      duplicates_collapsed: duplicatesCollapsed,
      operator_message: ativmobOperatorMessage({
        imported,
        deliveredRows: parsed.stats.delivered_rows,
        unmappedCount,
        duplicatesCollapsed,
        topUnmapped: unmappedSummaryRows,
      }),
      report: parsed.meta,
      stats: {
        ...parsed.stats,
        duplicates_collapsed: duplicatesCollapsed,
        upsert_rows: uniqueInserts.length,
      },
      unmapped_count: unmappedCount,
      unmapped_sample: unmapped.slice(0, 20),
      unmapped_summary: unmappedSummaryRows,
    });
  });
}

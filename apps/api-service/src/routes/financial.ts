import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { supabase } from '../lib/supabase';
import { authenticate, requireRole } from '../middleware/authenticate';
import { generateInstallments } from '../lib/financialInstallments';
import {
  buildDefaultRuleForType,
  mergeDiscountRulesFromJson,
  resolveDailyEntryStartDateIso,
  type DiscountRule,
} from '../lib/financialDiscountRules';
import {
  isValidSlug,
  loadEntryTypes,
  saveEntryTypes,
  type AffectsNet,
  type FinancialEntryType,
} from '../lib/financialEntryTypes';
import { buildMonthlyDriverSummary, buildWeeklyDriverSummary } from '../lib/financialSummaries';
import { requireWorkspace } from '../lib/workspaceContext';

const entrySchema = z.object({
  driver_id: z.string().uuid(),
  pharmacy_id: z.string().uuid().optional(),
  type: z.string().min(1).regex(/^[a-z][a-z0-9_]{0,30}$/),
  description: z.string().optional(),
  total_amount: z.number().positive(),
  installments_count: z.number().int().min(1).default(1),
  frequency: z.enum(['weekly', 'monthly']).default('weekly'),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().optional(),
});

const discountRulesPutSchema = z.object({
  rules: z.record(z.any()),
});

const entryTypeCreateSchema = z.object({
  slug: z.string().regex(/^[a-z][a-z0-9_]{0,30}$/),
  label: z.string().min(1).max(40),
  affects_net: z.enum(['discount', 'daily', 'ignore']).optional(),
});

const entryTypePatchSchema = z.object({
  label: z.string().min(1).max(40).optional(),
  active: z.boolean().optional(),
  affects_net: z.enum(['discount', 'daily', 'ignore']).optional(),
});

async function loadMergedDiscountRules(workspaceId: string): Promise<Record<string, DiscountRule>> {
  const { data } = await supabase.from('app_settings').select('value').eq('workspace_id', workspaceId).eq('key', 'financial_discount_rules').maybeSingle();
  return mergeDiscountRulesFromJson(data?.value ?? null);
}

async function persistDiscountRules(workspaceId: string, rules: Record<string, DiscountRule>): Promise<void> {
  await supabase
    .from('app_settings')
    .upsert({ workspace_id: workspaceId, key: 'financial_discount_rules', value: { rules }, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,key' });
}

const exportFilterSchema = z.object({
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  pharmacy_id: z.string().uuid().optional(),
  type: z.string().optional(),
  status: z.string().optional(),
  driver_id: z.string().uuid().optional(),
});

const financialSummaryQuerySchema = z.object({
  driver_id: z.string().uuid(),
  month: z.string().regex(/^\d{4}-\d{2}$/),
});

const financialWeeklySummaryQuerySchema = z.object({
  driver_id: z.string().uuid(),
  reference_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export async function financialRoutes(app: FastifyInstance) {
  // GET /api/financial/discount-rules
  app.get('/discount-rules', { preHandler: [authenticate, requireRole('admin', 'financial', 'operational', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const rules = await loadMergedDiscountRules(workspaceId);
    return reply.send({ rules });
  });

  // PUT /api/financial/discount-rules
  app.put('/discount-rules', { preHandler: [authenticate, requireRole('admin', 'financial')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = discountRulesPutSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    const merged = mergeDiscountRulesFromJson({ rules: parsed.data.rules });
    const { data, error } = await supabase
      .from('app_settings')
      .upsert({ workspace_id: workspaceId, key: 'financial_discount_rules', value: { rules: merged }, updated_at: new Date().toISOString() }, { onConflict: 'workspace_id,key' })
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send({ rules: merged, updated_at: data?.updated_at });
  });

  // GET /api/financial/entry-types — catálogo dinâmico de tipos de lançamento
  app.get('/entry-types', { preHandler: [authenticate, requireRole('admin', 'financial', 'operational', 'supervisor')] }, async (_request, reply) => {
    const types = await loadEntryTypes();
    return reply.send({ types });
  });

  // POST /api/financial/entry-types — cria novo tipo customizado e injeta regra default
  app.post('/entry-types', { preHandler: [authenticate, requireRole('admin', 'financial')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const parsed = entryTypeCreateSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });
    if (!isValidSlug(parsed.data.slug)) return reply.status(400).send({ error: 'Slug inválido' });

    const current = await loadEntryTypes();
    if (current.some((t) => t.slug === parsed.data.slug)) {
      return reply.status(409).send({ error: 'Já existe um tipo com esse slug' });
    }

    const newType: FinancialEntryType = {
      slug: parsed.data.slug,
      label: parsed.data.label.trim(),
      active: true,
      is_system: false,
      affects_net: (parsed.data.affects_net ?? 'discount') as AffectsNet,
      created_at: new Date().toISOString(),
    };
    const next = await saveEntryTypes([...current, newType]);

    // Injeta uma regra default para o novo tipo, salvando merged em financial_discount_rules.
    const rules = await loadMergedDiscountRules(workspaceId);
    if (!rules[newType.slug]) {
      rules[newType.slug] = buildDefaultRuleForType(newType.slug);
      await persistDiscountRules(workspaceId, rules);
    }

    const created = next.find((t) => t.slug === newType.slug)!;
    return reply.status(201).send({ type: created, types: next });
  });

  // PATCH /api/financial/entry-types/:slug — atualiza label/active/affects_net (não permite slug imutável)
  app.patch('/entry-types/:slug', { preHandler: [authenticate, requireRole('admin', 'financial')] }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    if (!isValidSlug(slug)) return reply.status(400).send({ error: 'Slug inválido' });
    const parsed = entryTypePatchSchema.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: 'Dados inválidos', details: parsed.error.flatten() });

    const current = await loadEntryTypes();
    const idx = current.findIndex((t) => t.slug === slug);
    if (idx < 0) return reply.status(404).send({ error: 'Tipo não encontrado' });

    const target = current[idx];
    // Proteção: não permitir desativar `daily` ou alterar seu affects_net (regra de negócio core).
    if (target.slug === 'daily') {
      if (parsed.data.active === false) return reply.status(400).send({ error: 'O tipo "daily" não pode ser desativado' });
      if (parsed.data.affects_net && parsed.data.affects_net !== 'daily') {
        return reply.status(400).send({ error: 'O tipo "daily" não pode alterar affects_net' });
      }
    }

    const updated: FinancialEntryType = {
      ...target,
      label: parsed.data.label?.trim() ?? target.label,
      active: parsed.data.active ?? target.active,
      affects_net: (parsed.data.affects_net ?? target.affects_net) as AffectsNet,
    };
    const list = [...current];
    list[idx] = updated;
    const next = await saveEntryTypes(list);
    return reply.send({ type: next.find((t) => t.slug === slug), types: next });
  });

  // GET /api/financial/summary?driver_id=&month=YYYY-MM
  app.get('/summary', { preHandler: [authenticate, requireRole('admin', 'financial', 'operational', 'supervisor')] }, async (request, reply) => {
    const parsed = financialSummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Parâmetros inválidos', details: parsed.error.flatten() });
    }
    const { driver_id, month } = parsed.data;
    try {
      const summary = await buildMonthlyDriverSummary(driver_id, month);
      return reply.send(summary);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao montar resumo';
      return reply.status(500).send({ error: msg });
    }
  });

  // GET /api/financial/weekly-summary?driver_id=&reference_date=YYYY-MM-DD
  app.get('/weekly-summary', { preHandler: [authenticate, requireRole('admin', 'financial', 'operational', 'supervisor')] }, async (request, reply) => {
    const parsed = financialWeeklySummaryQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Parâmetros inválidos', details: parsed.error.flatten() });
    }

    const { driver_id, reference_date } = parsed.data;
    try {
      const summary = await buildWeeklyDriverSummary(driver_id, reference_date);
      return reply.send(summary);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Erro ao montar resumo semanal';
      return reply.status(500).send({ error: msg });
    }
  });

  // GET /api/financial/entries
  app.get('/entries', { preHandler: [authenticate, requireRole('admin', 'financial', 'operational')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { driver_id, status, type } = request.query as Record<string, string>;
    let query = supabase
      .from('financial_entries')
      .select(`
        *,
        drivers(id, name, cpf, phone),
        pharmacies(id, trade_name),
        created_by_user:users!created_by(id, name),
        approved_by_user:users!approved_by(id, name),
        financial_installments(id, installment_number, amount, due_date, status, paid_at)
      `)
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false });
    if (driver_id) query = query.eq('driver_id', driver_id);
    if (status) query = query.eq('status', status);
    if (type) query = query.eq('type', type);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // GET /api/financial/entries/:id — Detalhe para aprovação (mesmos papéis da lista)
  app.get('/entries/:id', { preHandler: [authenticate, requireRole('admin', 'financial', 'operational', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('financial_entries')
      .select(`
        *,
        drivers(*),
        pharmacies(*),
        created_by_user:users!created_by(id, name, role),
        approved_by_user:users!approved_by(id, name),
        financial_installments(id, installment_number, amount, due_date, status, paid_at)
      `)
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .single();
    
    if (error) return reply.status(404).send({ error: 'Lançamento não encontrado' });
    return reply.send(data);
  });

  // POST /api/financial/entries — criar lançamento com regra de diária
  app.post('/entries', { preHandler: [authenticate, requireRole('admin', 'financial', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = entrySchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
    const user = request.user as { sub: string };

    const fromTaskHeader = request.headers['x-from-task'];
    const fromTaskId = typeof fromTaskHeader === 'string' ? fromTaskHeader.trim() : '';
    if (fromTaskId) {
      const { data: task, error: taskErr } = await supabase
        .from('pending_tasks')
        .select('id, task_type, status, driver_id, metadata')
        .eq('workspace_id', workspaceId)
        .eq('id', fromTaskId)
        .single();
      if (taskErr || !task) return reply.status(400).send({ error: 'x-from-task inválido' });
      if (task.task_type !== 'financial_advance_request') {
        return reply.status(400).send({ error: 'x-from-task não é de adiantamento' });
      }
      const meta =
        task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
          ? (task.metadata as Record<string, unknown>)
          : {};
      const decision = String(meta.decision || '');
      if (decision !== 'approved') {
        return reply.status(400).send({ error: 'A pendência ainda não foi aprovada' });
      }
      const taskDriverId = typeof task.driver_id === 'string' ? task.driver_id : String(meta.driver_id || '');
      if (!taskDriverId || body.data.driver_id !== taskDriverId) {
        return reply.status(400).send({ error: 'driver_id divergente da pendência aprovada' });
      }
      if (body.data.type !== 'advance') {
        return reply.status(400).send({ error: 'type deve ser advance no contexto de aprovação' });
      }
      const decidedAt = String(meta.decided_at || '').trim();
      const enforcedStartDate = (decidedAt ? new Date(decidedAt) : new Date()).toISOString().slice(0, 10);
      if (body.data.start_date !== enforcedStartDate) {
        return reply.status(400).send({ error: 'start_date deve ser a data de aprovação da pendência' });
      }
    }

    // Validação dinâmica do tipo contra o catálogo (somente ativos).
    const types = await loadEntryTypes();
    const typeMeta = types.find((t) => t.slug === body.data.type);
    if (!typeMeta || !typeMeta.active) {
      return reply.status(400).send({ error: `Tipo "${body.data.type}" inválido ou inativo` });
    }

    let start_date = body.data.start_date;

    const discountRules = await loadMergedDiscountRules(workspaceId);
    if (body.data.type === 'daily') {
      const dailyRule = discountRules.daily;
      start_date = resolveDailyEntryStartDateIso(new Date(), dailyRule);
    }

    const installment_amount = Number((body.data.total_amount / body.data.installments_count).toFixed(2));

    // Diárias e faltas precisam de aprovação (regra core preservada).
    const requiresApproval = ['daily', 'absence'].includes(body.data.type);
    const initialStatus = requiresApproval ? 'pending_approval' : 'active';
    
    const { data: entry, error } = await supabase
      .from('financial_entries')
      .insert({ workspace_id: workspaceId, ...body.data, start_date, installment_amount, status: initialStatus, created_by: user.sub })
      .select().single();
    if (error) return reply.status(500).send({ error: error.message });

    // Gera parcelas automaticamente
    const installments = generateInstallments(entry.id, start_date, body.data.installments_count, installment_amount, body.data.frequency);
    await supabase.from('financial_installments').insert(installments.map((row) => ({ ...row, workspace_id: workspaceId })));

    // Se foi aprovado automaticamente, registra no audit log
    if (!requiresApproval) {
      await supabase.from('audit_logs').insert({
        workspace_id: workspaceId,
        user_id: user.sub, entity_type: 'financial_entry', entity_id: entry.id,
        action: 'auto_approved', new_data: { status: 'active', reason: 'auto_approval_for_non_daily_types' },
      });
    }

    return reply.status(201).send(entry);
  });

  // PATCH /api/financial/entries/:id/submit — enviar para aprovação
  app.patch('/entries/:id/submit', { preHandler: [authenticate, requireRole('admin', 'financial')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { data, error } = await supabase
      .from('financial_entries').update({ status: 'pending_approval', updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).eq('status', 'draft').select().single();
    if (error) return reply.status(500).send({ error: error.message });
    return reply.send(data);
  });

  // PATCH /api/financial/entries/:id/approve — aprovar
  app.patch('/entries/:id/approve', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const user = request.user as { sub: string };
    const { data, error } = await supabase
      .from('financial_entries')
      .update({ status: 'active', approved_by: user.sub, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId).eq('id', id).eq('status', 'pending_approval').select().single();
    if (error) return reply.status(500).send({ error: error.message });
    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: user.sub, entity_type: 'financial_entry', entity_id: id,
      action: 'approved', new_data: { status: 'active' },
    });
    return reply.send(data);
  });

  // PATCH /api/financial/entries/:id/reject — rejeitar
  app.patch('/entries/:id/reject', { preHandler: [authenticate, requireRole('admin', 'supervisor')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { rejection_reason } = request.body as { rejection_reason: string };
    const user = request.user as { sub: string };
    const { data, error } = await supabase
      .from('financial_entries')
      .update({ status: 'draft', rejection_reason, updated_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .eq('status', 'pending_approval')
      .select()
      .single();
    if (error) return reply.status(500).send({ error: error.message });
    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: user.sub, entity_type: 'financial_entry', entity_id: id,
      action: 'rejected', new_data: { rejection_reason },
    });
    return reply.send(data);
  });

  // GET /api/financial/installments — parcelas com filtros
  app.get('/installments', { preHandler: [authenticate, requireRole('admin', 'financial', 'operational')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { status, due_start, due_end, driver_id } = request.query as Record<string, string>;
    let query = supabase
      .from('financial_installments')
      .select(`
        *,
        financial_entries(
          id, type, description, driver_id, pharmacy_id,
          drivers(id, name, cpf, phone),
          pharmacies(id, trade_name)
        ),
        paid_by_user:users!paid_by(id, name)
      `)
      .eq('workspace_id', workspaceId)
      .order('due_date');
    if (status) query = query.eq('status', status);
    if (due_start) query = query.gte('due_date', due_start);
    if (due_end) query = query.lte('due_date', due_end);
    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    // Filtro em memória por driver_id (via join aninhado)
    const filtered = driver_id
      ? data?.filter((i: { financial_entries: { driver_id: string } }) => i.financial_entries?.driver_id === driver_id)
      : data;
    return reply.send(filtered);
  });

  // PATCH /api/financial/installments/:id/pay — dar baixa em parcela
  app.patch('/installments/:id/pay', { preHandler: [authenticate, requireRole('admin', 'financial')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const { notes } = request.body as { notes?: string };
    const user = request.user as { sub: string };

    const { data: before } = await supabase.from('financial_installments').select('*').eq('workspace_id', workspaceId).eq('id', id).single();
    const { data, error } = await supabase
      .from('financial_installments')
      .update({ status: 'paid', paid_at: new Date().toISOString(), paid_by: user.sub, notes: notes || null })
      .eq('workspace_id', workspaceId).eq('id', id).eq('status', 'pending').select().single();
    if (error) return reply.status(500).send({ error: error.message });

    await supabase.from('audit_logs').insert({
      workspace_id: workspaceId,
      user_id: user.sub, entity_type: 'financial_installment', entity_id: id,
      action: 'paid', old_data: before, new_data: data,
    });

    // Verifica se todas as parcelas estão pagas e atualiza entry para 'settled'
    const { data: entry } = await supabase.from('financial_installments')
      .select('status').eq('workspace_id', workspaceId).eq('entry_id', data.entry_id);
    const allPaid = entry?.every((i: { status: string }) => i.status === 'paid');
    if (allPaid) {
      await supabase.from('financial_entries').update({ status: 'settled', updated_at: new Date().toISOString() }).eq('workspace_id', workspaceId).eq('id', data.entry_id);
    }

    return reply.send(data);
  });

  // POST /api/financial/export — exportar planilha
  app.post('/export', { preHandler: [authenticate, requireRole('admin', 'financial')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = exportFilterSchema.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: 'Filtros inválidos' });

    let query = supabase
      .from('financial_installments')
      .select(`
        installment_number, amount, due_date, status, reference, paid_at, notes,
        financial_entries(
          type, description,
          drivers(name, cpf, phone, primary_pharmacy_id),
          pharmacies(trade_name)
        )
      `)
      .eq('workspace_id', workspaceId)
      .order('due_date');

    if (body.data.start_date) query = query.gte('due_date', body.data.start_date);
    if (body.data.end_date) query = query.lte('due_date', body.data.end_date);
    if (body.data.status) query = query.eq('status', body.data.status);
    if (body.data.type) query = query.eq('financial_entries.type', body.data.type);

    const { data, error } = await query;
    if (error) return reply.status(500).send({ error: error.message });

    // Gera CSV simplificado (em produção: usar ExcelJS para .xlsx)
    const rows = (data || []).map((i: Record<string, unknown>) => {
      const entry = i.financial_entries as Record<string, unknown>;
      const driver = entry?.drivers as Record<string, unknown>;
      const pharmacy = entry?.pharmacies as Record<string, unknown>;
      return [
        driver?.name, driver?.cpf, driver?.phone,
        pharmacy?.trade_name, entry?.type,
        i.installment_number, i.amount, i.due_date,
        i.status, i.paid_at, i.reference, i.notes,
      ].join(';');
    });

    const csv = ['Nome;CPF;Telefone;Farmácia;Tipo;Parcela;Valor;Vencimento;Status;Pagamento;Referência;Obs', ...rows].join('\n');
    return reply.header('Content-Type', 'text/csv').header('Content-Disposition', 'attachment; filename=conferencia_financeira.csv').send(csv);
  });

  // POST /api/financial/import — importar Excel do ERP
  app.post('/import', { preHandler: [authenticate, requireRole('admin', 'financial')] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const data = await request.file();
    if (!data) return reply.status(400).send({ error: 'Nenhum arquivo enviado' });

    const user = request.user as { sub: string };
    const ExcelJS = require('exceljs');
    const workbook = new ExcelJS.Workbook();
    
    try {
      await workbook.xlsx.read(data.file);
      const worksheet = workbook.getWorksheet(1);
      const rows: any[] = [];
      
      // Criar registro da importação
      const { data: importRecord, error: importError } = await supabase
        .from('financial_imports')
        .insert({
          workspace_id: workspaceId,
          file_name: data.filename,
          imported_by: user.sub,
          status: 'processing',
          started_at: new Date().toISOString()
        })
        .select().single();

      if (importError) throw importError;

      // Ler linhas do Excel
      // Assume-se: Coluna 1: Nome, Coluna 2: CPF, Coluna 3: Valor
      worksheet.eachRow((row: any, rowNumber: number) => {
        if (rowNumber === 1) return; // Pular cabeçalho
        const name = row.getCell(1).text;
        const cpf = row.getCell(2).text;
        const amount = Number(row.getCell(3).value);
        
        if (cpf && !isNaN(amount)) {
          rows.push({
            workspace_id: workspaceId,
            import_id: importRecord.id,
            driver_name: name,
            driver_cpf: cpf.replace(/\D/g, ''),
            gross_amount: amount,
            status: 'pending'
          });
        }
      });

      if (rows.length > 0) {
        // Salvar linhas para processamento posterior ou processar agora
        await supabase.from('financial_import_rows').insert(rows);
        
        // Atualizar estatísticas
        await supabase.from('financial_imports')
          .update({ 
            total_rows: rows.length,
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('workspace_id', workspaceId)
          .eq('id', importRecord.id);
      } else {
        await supabase.from('financial_imports')
          .update({ status: 'failed', error_message: 'Nenhuma linha válida encontrada' })
          .eq('workspace_id', workspaceId)
          .eq('id', importRecord.id);
      }

      return reply.send({ message: 'Importação concluída', import_id: importRecord.id, rows_found: rows.length });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Falha ao processar arquivo' });
    }
  });

  // POST /api/financial/import-billing — Ingestão de Excel do ERP
  app.post('/import-billing', { preHandler: [authenticate, requireRole('admin', 'financial')] }, async (request, reply) => {
    const data = await (request as any).file();
    if (!data) return reply.status(400).send({ error: 'Arquivo nao enviado' });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.read(data.file);
    const worksheet = workbook.getWorksheet(1);
    
    if (!worksheet) return reply.status(400).send({ error: 'Planilha vazia ou invalida' });

    const results: any[] = [];
    const errors: any[] = [];

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const name = row.getCell(1).value?.toString();
      const cpf = row.getCell(2).value?.toString().replace(/\D/g, '');
      const value = parseFloat(row.getCell(3).value?.toString() || '0');
      if (!cpf || isNaN(value)) {
        errors.push({ row: rowNumber, error: 'CPF ou Valor invalidos' });
        return;
      }
      results.push({ name, cpf, value });
    });

    return reply.send({ 
      message: 'Arquivo processado com sucesso', 
      processed: results.length,
      errors: errors.length > 0 ? errors : undefined
    });
  });
}

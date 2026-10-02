"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerFinancialEntryRoutes = registerFinancialEntryRoutes;
const authenticate_1 = require("../../middleware/authenticate");
const financialAuth_1 = require("../../lib/financialAuth");
const supabase_1 = require("../../lib/supabase");
const workspaceContext_1 = require("../../lib/workspaceContext");
const financialInstallments_1 = require("../../lib/financialInstallments");
const financialEntryFactory_1 = require("../../lib/financialEntryFactory");
const financialEntryTypes_1 = require("../../lib/financialEntryTypes");
const shared_1 = require("./shared");
function hasHydratedCoverageRef(raw) {
    const ref = Array.isArray(raw) ? raw.find((item) => item && typeof item === 'object') : raw;
    if (!ref || typeof ref !== 'object')
        return false;
    const obj = ref;
    return Boolean(obj.id && (obj.event_date || obj.occurrence_kind || obj.notes || obj.drivers));
}
async function hydrateCoverageRefs(workspaceId, rows) {
    const missingIds = Array.from(new Set(rows
        .filter((row) => row.coverage_of_entry_id && !hasHydratedCoverageRef(row.coverage_of_entry))
        .map((row) => String(row.coverage_of_entry_id))));
    if (!missingIds.length)
        return rows;
    const { data, error } = await supabase_1.supabase
        .from('financial_entries')
        .select(`
      id, type, occurrence_kind, event_date, status, notes,
      absence_disposition, proposed_discount_amount,
      drivers(id, name)
    `)
        .eq('workspace_id', workspaceId)
        .in('id', missingIds);
    if (error)
        throw new Error(error.message);
    const byId = new Map((data || []).map((entry) => [String(entry.id), entry]));
    return rows.map((row) => {
        const linkedId = row.coverage_of_entry_id ? String(row.coverage_of_entry_id) : '';
        const linked = linkedId ? byId.get(linkedId) : null;
        return linked ? { ...row, coverage_of_entry: linked } : row;
    });
}
async function registerFinancialEntryRoutes(app) {
    app.get('/entries', { preHandler: [authenticate_1.authenticate, financialAuth_1.requireFinancialView] }, async (request, reply) => {
        const workspaceId = await (0, workspaceContext_1.requireWorkspace)(request, reply);
        if (!workspaceId)
            return;
        const { driver_id, status, type, pharmacy_id, leader_id, due_date, installment_status } = request.query;
        let leaderPharmacyIds = null;
        if (leader_id) {
            const { data: phRows, error: phErr } = await supabase_1.supabase
                .from('pharmacies')
                .select('id')
                .eq('workspace_id', workspaceId)
                .eq('leader_id', leader_id);
            if (phErr)
                return reply.status(500).send({ error: phErr.message });
            leaderPharmacyIds = (phRows || []).map((p) => p.id);
            if (!leaderPharmacyIds.length)
                return reply.send([]);
        }
        let query = supabase_1.supabase
            .from('financial_entries')
            .select(`
        *,
        drivers(id, name, cpf, phone, primary_pharmacy_id),
        ${shared_1.FINANCIAL_PHARMACY_LIST_SELECT},
        created_by_user:users!created_by(id, name),
        approved_by_user:users!approved_by(id, name),
        financial_installments(id, installment_number, amount, due_date, status, paid_at),
        ${shared_1.FINANCIAL_ENTRY_COVERAGE_SELECT}
      `)
            .eq('workspace_id', workspaceId)
            .order('created_at', { ascending: false });
        if (driver_id)
            query = query.eq('driver_id', driver_id);
        if (status)
            query = query.eq('status', status);
        if (type)
            query = query.eq('type', type);
        if (pharmacy_id)
            query = query.eq('pharmacy_id', pharmacy_id);
        if (leaderPharmacyIds)
            query = query.in('pharmacy_id', leaderPharmacyIds);
        const { data, error } = await query;
        if (error)
            return reply.status(500).send({ error: error.message });
        let rows = data || [];
        if (due_date || installment_status) {
            rows = rows.filter((entry) => {
                const insts = (entry.financial_installments || []);
                const onRef = due_date ? insts.filter((i) => i.due_date === due_date) : insts;
                if (due_date && onRef.length === 0)
                    return false;
                if (!installment_status || installment_status === 'all')
                    return true;
                const entryType = String(entry.type || '');
                if (installment_status === 'pending')
                    return onRef.some((i) => i.status === 'pending');
                if (installment_status === 'paid') {
                    return onRef.some((i) => i.status === 'paid' && entryType === 'daily');
                }
                if (installment_status === 'discounted') {
                    return onRef.some((i) => i.status === 'paid' && entryType !== 'daily');
                }
                return true;
            });
        }
        try {
            rows = await hydrateCoverageRefs(workspaceId, rows);
        }
        catch (e) {
            return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao carregar vínculo da cobertura' });
        }
        return reply.send(rows);
    });
    app.get('/entries/:id', { preHandler: [authenticate_1.authenticate, financialAuth_1.requireFinancialView] }, async (request, reply) => {
        const workspaceId = await (0, workspaceContext_1.requireWorkspace)(request, reply);
        if (!workspaceId)
            return;
        const { id } = request.params;
        const { data, error } = await supabase_1.supabase
            .from('financial_entries')
            .select(`
        *,
        drivers(id, name, cpf, phone, primary_pharmacy_id, pix_key, status, work_schedule),
        ${shared_1.FINANCIAL_PHARMACY_DETAIL_SELECT},
        created_by_user:users!created_by(id, name),
        approved_by_user:users!approved_by(id, name),
        financial_installments(id, installment_number, amount, due_date, status, paid_at),
        ${shared_1.FINANCIAL_ENTRY_COVERAGE_SELECT}
      `)
            .eq('workspace_id', workspaceId)
            .eq('id', id)
            .single();
        if (error) {
            const notFound = error.code === 'PGRST116';
            return reply.status(notFound ? 404 : 500).send({
                error: notFound ? 'Lançamento não encontrado' : error.message,
            });
        }
        try {
            const [hydrated] = await hydrateCoverageRefs(workspaceId, [data]);
            return reply.send(hydrated);
        }
        catch (e) {
            return reply.status(500).send({ error: e instanceof Error ? e.message : 'Erro ao carregar vínculo da cobertura' });
        }
    });
    app.post('/entries', { preHandler: [authenticate_1.authenticate, financialAuth_1.requireFinancialManage] }, async (request, reply) => {
        const workspaceId = await (0, workspaceContext_1.requireWorkspace)(request, reply);
        if (!workspaceId)
            return;
        const body = shared_1.entrySchema.safeParse(request.body);
        if (!body.success)
            return reply.status(400).send({ error: 'Dados inválidos', details: body.error.flatten() });
        const user = request.user;
        const fromTaskHeader = request.headers['x-from-task'];
        const fromTaskId = typeof fromTaskHeader === 'string' ? fromTaskHeader.trim() : '';
        if (fromTaskId) {
            const { data: task, error: taskErr } = await supabase_1.supabase
                .from('pending_tasks')
                .select('id, task_type, status, driver_id, metadata')
                .eq('workspace_id', workspaceId)
                .eq('id', fromTaskId)
                .single();
            if (taskErr || !task)
                return reply.status(400).send({ error: 'x-from-task inválido' });
            if (task.task_type !== 'financial_advance_request') {
                return reply.status(400).send({ error: 'x-from-task não é de adiantamento' });
            }
            const meta = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
                ? task.metadata
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
        const types = await (0, financialEntryTypes_1.loadEntryTypes)();
        const typeMeta = types.find((t) => t.slug === body.data.type);
        if (!typeMeta || !typeMeta.active) {
            return reply.status(400).send({ error: `Tipo "${body.data.type}" inválido ou inativo` });
        }
        if (['daily', 'absence'].includes(body.data.type)) {
            return reply.status(400).send({
                error: 'Diárias e faltas devem ser registradas via Ocorrência de escala.',
            });
        }
        const initialStatus = 'active';
        if (!body.data.start_date) {
            return reply.status(400).send({ error: 'start_date obrigatório para este tipo' });
        }
        const discountRules = await (0, shared_1.loadMergedDiscountRules)(workspaceId);
        const start_date = body.data.start_date || new Date().toISOString().slice(0, 10);
        const computed = (0, financialEntryFactory_1.computeFinancialEntryFields)({
            workspace_id: workspaceId,
            created_by: user.sub,
            driver_id: body.data.driver_id,
            pharmacy_id: body.data.pharmacy_id || '',
            type: body.data.type,
            total_amount: body.data.total_amount,
            installments_count: body.data.installments_count,
            frequency: body.data.frequency,
            notes: body.data.notes,
            description: body.data.description,
            status: initialStatus,
            event_date: body.data.event_date,
        }, discountRules, new Date());
        const { data: entry, error } = await supabase_1.supabase
            .from('financial_entries')
            .insert({
            workspace_id: workspaceId,
            driver_id: body.data.driver_id,
            pharmacy_id: body.data.pharmacy_id,
            type: body.data.type,
            description: computed.description,
            total_amount: body.data.total_amount,
            installments_count: body.data.installments_count,
            installment_amount: computed.installment_amount,
            frequency: body.data.frequency,
            start_date: computed.start_date,
            status: initialStatus,
            notes: computed.notes,
            event_date: computed.event_date,
            apuracao_start: computed.apuracao_start,
            apuracao_end: computed.apuracao_end,
            created_by: user.sub,
        })
            .select()
            .single();
        if (error)
            return reply.status(500).send({ error: error.message });
        const installments = (0, financialInstallments_1.generateInstallments)(entry.id, computed.start_date, body.data.installments_count, computed.installment_amount, body.data.frequency, body.data.type, discountRules);
        await supabase_1.supabase.from('financial_installments').insert(installments.map((row) => ({ ...row, workspace_id: workspaceId })));
        await supabase_1.supabase.from('audit_logs').insert({
            workspace_id: workspaceId,
            user_id: user.sub,
            entity_type: 'financial_entry',
            entity_id: entry.id,
            action: 'auto_approved',
            new_data: { status: 'active', reason: 'auto_approval_for_non_daily_types' },
        });
        return reply.status(201).send(entry);
    });
}

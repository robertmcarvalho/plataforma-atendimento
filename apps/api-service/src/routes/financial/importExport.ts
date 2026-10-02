import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import { requireFinancialExport } from '../../lib/financialAuth';
import { supabase } from '../../lib/supabase';
import { requireWorkspace } from '../../lib/workspaceContext';
import { buildFinancialDailiesXlsx } from '../../lib/financialDailyXlsxExport';
import { previousClosedCycleMonSun } from '../../lib/financialDiscountRules';
import {
  dailyExportFilterSchema,
  exportFilterSchema,
  loadMergedDiscountRules,
} from './shared';

export async function registerFinancialImportExportRoutes(app: FastifyInstance) {
  // POST /api/financial/export — exportar planilha
  app.post('/export', { preHandler: [authenticate, requireFinancialExport] }, async (request, reply) => {
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

  app.post('/export/dailies', { preHandler: [authenticate, requireFinancialExport] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const body = dailyExportFilterSchema.safeParse(request.body ?? {});
    if (!body.success) return reply.status(400).send({ error: 'Filtros inválidos', details: body.error.flatten() });

    const rules = await loadMergedDiscountRules(workspaceId);
    const { buffer, filename, rowCount } = await buildFinancialDailiesXlsx(
      supabase,
      workspaceId,
      rules,
      body.data,
    );

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .header('X-Export-Row-Count', String(rowCount))
      .send(buffer);
  });

  const importBillingHandler = async (request: any, reply: any) => {
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

      const paymentRef = new Date().toISOString().slice(0, 10);
      const apuracao = previousClosedCycleMonSun(paymentRef);

      const pendingRows: Array<{
        workspace_id: string;
        import_id: string;
        driver_name: string;
        driver_cpf: string;
        gross_amount: number;
        status: string;
        driver_id?: string;
      }> = [];

      worksheet.eachRow((row: any, rowNumber: number) => {
        if (rowNumber === 1) return;
        const name = row.getCell(1).text;
        const cpf = row.getCell(2).text?.replace(/\D/g, '');
        const amount = Number(row.getCell(3).value);
        if (cpf && cpf.length >= 11 && !isNaN(amount)) {
          pendingRows.push({
            workspace_id: workspaceId,
            import_id: importRecord.id,
            driver_name: name,
            driver_cpf: cpf,
            gross_amount: amount,
            status: 'pending',
          });
        }
      });

      for (const pr of pendingRows) {
        const { data: driver } = await supabase
          .from('drivers')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('cpf', pr.driver_cpf)
          .maybeSingle();
        if (driver?.id) {
          rows.push({ ...pr, driver_id: driver.id });
        } else {
          rows.push(pr);
        }
      }

      if (rows.length > 0) {
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

      return reply.send({
        message: 'Importação concluída',
        import_id: importRecord.id,
        rows_found: rows.length,
        apuracao_start: apuracao.startDate,
        apuracao_end: apuracao.endDate,
        payment_reference: paymentRef,
      });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Falha ao processar arquivo' });
    }
  };

  app.post('/import', { preHandler: [authenticate, requireFinancialExport] }, importBillingHandler);

}

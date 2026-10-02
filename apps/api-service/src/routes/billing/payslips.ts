import type { FastifyInstance } from 'fastify';
import { authenticate } from '../../middleware/authenticate';
import { requireBillingModule } from '../../middleware/requireBillingModule';
import { requireFinancialManage, requireFinancialView } from '../../lib/financialAuth';
import { requireWorkspace, type JwtUser } from '../../lib/workspaceContext';
import { buildDriverPayslip } from '../../lib/billingPayslip';
import { generatePayslipPdf, parsePayslipPdfTheme } from '../../lib/billingPayslipPdf';
import { revokePayslipTokens, sendDriverPayslip } from '../../lib/billingPayslipSend';

export async function registerBillingPayslipRoutes(app: FastifyInstance) {
  const preView = [authenticate, requireBillingModule, requireFinancialView] as const;
  const preManage = [authenticate, requireBillingModule, requireFinancialManage] as const;

  app.get('/payables/:id/payslip', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      const payslip = await buildDriverPayslip({ workspaceId, payableId: id });
      if (!payslip) return reply.status(404).send({ error: 'Recibo não encontrado para este título' });
      return reply.send({ payslip });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro ao montar recibo' });
    }
  });

  app.get('/payables/:id/payslip/pdf', { preHandler: [...preView] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const theme = parsePayslipPdfTheme((request.query as { theme?: string }).theme);
    try {
      const payslip = await buildDriverPayslip({ workspaceId, payableId: id });
      if (!payslip) return reply.status(404).send({ error: 'Recibo não encontrado para este título' });
      const pdf = await generatePayslipPdf(payslip, { theme });
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="recibo-${payslip.driver.name.replace(/\s+/g, '-')}.pdf"`)
        .send(pdf);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro ao gerar PDF' });
    }
  });

  app.post('/payables/:id/payslip/send', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    const user = request.user as JwtUser;
    try {
      const result = await sendDriverPayslip({
        workspaceId,
        payableId: id,
        createdBy: user?.sub || null,
      });
      return reply.send(result);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro ao enviar recibo';
      const status = message.includes('não encontrado') ? 404 : 500;
      return reply.status(status).send({ error: message });
    }
  });

  app.post('/payables/:id/payslip/revoke', { preHandler: [...preManage] }, async (request, reply) => {
    const workspaceId = await requireWorkspace(request, reply);
    if (!workspaceId) return;
    const { id } = request.params as { id: string };
    try {
      await revokePayslipTokens(workspaceId, id);
      return reply.send({ ok: true });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro ao revogar link' });
    }
  });
}

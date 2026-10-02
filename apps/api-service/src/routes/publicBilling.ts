import type { FastifyInstance } from 'fastify';
import { fetchPublicBillingReport } from '../lib/billingInvoiceEngine';
import { generatePayslipPdf, parsePayslipPdfTheme } from '../lib/billingPayslipPdf';
import { loadPublicPayslip } from '../lib/billingPayslipSend';

export async function publicBillingRoutes(app: FastifyInstance) {
  app.get('/payslip/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    try {
      const payslip = await loadPublicPayslip(token);
      if (!payslip) return reply.status(404).send({ error: 'Link inválido, expirado ou revogado' });
      return reply.send({ payslip });
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/payslip/:token/pdf', async (request, reply) => {
    const { token } = request.params as { token: string };
    const theme = parsePayslipPdfTheme((request.query as { theme?: string }).theme);
    try {
      const payslip = await loadPublicPayslip(token);
      if (!payslip) return reply.status(404).send({ error: 'Link inválido, expirado ou revogado' });
      const pdf = await generatePayslipPdf(payslip, { theme });
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', `inline; filename="recibo.pdf"`)
        .send(pdf);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });

  app.get('/reports/:token', async (request, reply) => {
    const { token } = request.params as { token: string };
    const query = request.query as { date?: string; driver_id?: string; pharmacy_id?: string; page?: string };
    try {
      const report = await fetchPublicBillingReport(token, {
        date: query.date || null,
        driver_id: query.driver_id || null,
        pharmacy_id: query.pharmacy_id || null,
        page: query.page ? Number(query.page) : null,
      });
      if (!report) return reply.status(404).send({ error: 'Relatório não encontrado' });
      return reply.send(report);
    } catch (err) {
      return reply.status(500).send({ error: err instanceof Error ? err.message : 'Erro' });
    }
  });
}

import type { FastifyInstance } from 'fastify';
import { registerFinancialConfigRoutes } from './config';
import { registerFinancialSummaryRoutes } from './summaries';
import { registerFinancialEntryRoutes } from './entries';
import { registerFinancialOccurrenceRoutes } from './occurrences';
import { registerFinancialWorkflowRoutes } from './workflow';
import { registerFinancialInstallmentRoutes } from './installments';
import { registerFinancialImportExportRoutes } from './importExport';

export async function financialRoutes(app: FastifyInstance) {
  await registerFinancialConfigRoutes(app);
  await registerFinancialSummaryRoutes(app);
  await registerFinancialEntryRoutes(app);
  await registerFinancialOccurrenceRoutes(app);
  await registerFinancialWorkflowRoutes(app);
  await registerFinancialInstallmentRoutes(app);
  await registerFinancialImportExportRoutes(app);
}

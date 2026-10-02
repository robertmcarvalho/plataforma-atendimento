import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src/routes/financial.ts');
const outDir = path.join(root, 'src/routes/financial');
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

const importBlock = slice(1, 107);

const shared = `${importBlock}

export {
  entrySchema,
  recalculateSchema,
  entryPatchSchema,
  discountRulesPutSchema,
  entryTypeCreateSchema,
  entryTypePatchSchema,
  exportFilterSchema,
  financialSummaryQuerySchema,
  financialWeeklySummaryQuerySchema,
  FINANCIAL_ENTRY_COVERAGE_SELECT,
  loadMergedDiscountRules,
  persistDiscountRules,
};
`;

const modules = [
  {
    file: 'config.ts',
    fn: 'registerFinancialConfigRoutes',
    body: slice(110, 206),
  },
  {
    file: 'summaries.ts',
    fn: 'registerFinancialSummaryRoutes',
    body: slice(207, 298),
  },
  {
    file: 'entries.ts',
    fn: 'registerFinancialEntryRoutes',
    body: slice(299, 522),
  },
  {
    file: 'occurrences.ts',
    fn: 'registerFinancialOccurrenceRoutes',
    body: slice(523, 619),
  },
  {
    file: 'workflow.ts',
    fn: 'registerFinancialWorkflowRoutes',
    body: slice(620, 879),
  },
  {
    file: 'installments.ts',
    fn: 'registerFinancialInstallmentRoutes',
    body: slice(880, 941),
  },
  {
    file: 'importExport.ts',
    fn: 'registerFinancialImportExportRoutes',
    body: slice(942, 1092),
  },
];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'shared.ts'), shared);

for (const mod of modules) {
  const content = `import type { FastifyInstance } from 'fastify';
import { authenticate, requireRole } from '../../middleware/authenticate';
import { supabase } from '../../lib/supabase';
import { requireWorkspace } from '../../lib/workspaceContext';
import { OccurrenceKind } from '@plataforma/operational-notes';
import { z } from 'zod';
import ExcelJS from 'exceljs';
import { generateInstallments } from '../../lib/financialInstallments';
import {
  buildDefaultRuleForType,
  mergeDiscountRulesFromJson,
  previousClosedCycleMonSun,
} from '../../lib/financialDiscountRules';
import { insertFinancialEntryWithInstallments, computeFinancialEntryFields } from '../../lib/financialEntryFactory';
import { recalculateFinancialEntries } from '../../lib/financialEntryRecalculate';
import {
  isValidSlug,
  loadEntryTypes,
  saveEntryTypes,
} from '../../lib/financialEntryTypes';
import { buildMonthlyDriverSummary, buildWeeklyDriverSummary } from '../../lib/financialSummaries';
import { writeAuditLog } from '../../lib/auditLog';
import {
  entrySchema,
  recalculateSchema,
  entryPatchSchema,
  discountRulesPutSchema,
  entryTypeCreateSchema,
  entryTypePatchSchema,
  exportFilterSchema,
  financialSummaryQuerySchema,
  financialWeeklySummaryQuerySchema,
  FINANCIAL_ENTRY_COVERAGE_SELECT,
  loadMergedDiscountRules,
  persistDiscountRules,
} from './shared';

export async function ${mod.fn}(app: FastifyInstance) {
${mod.body}
`;
  fs.writeFileSync(path.join(outDir, mod.file), content);
  console.log('wrote', mod.file);
}

const index = `import type { FastifyInstance } from 'fastify';
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
`;

fs.writeFileSync(path.join(outDir, 'index.ts'), index);
console.log('wrote index.ts — remove src/routes/financial.ts after build passes');

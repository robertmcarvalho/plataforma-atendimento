import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pagePath = path.join(root, 'src/app/(app)/financial/page.tsx');
const lines = fs.readFileSync(pagePath, 'utf8').split(/\r?\n/);

const slice = (start, end) => lines.slice(start - 1, end).join('\n');

write(
  'src/lib/financial/types.ts',
  `import type { DiscountRule } from '@/lib/financialCycle';

${slice(64, 65)
  .replace(/^type /gm, 'export type ')
  .replace(/^interface /gm, 'export interface ')}
${slice(67, 78).replace(/^type /gm, 'export type ')}
${slice(80, 118).replace(/^interface /gm, 'export interface ')}
${slice(135, 141).replace(/^interface /gm, 'export interface ')}
${slice(152, 155).replace(/^interface /gm, 'export interface ')}
${slice(899, 899).replace(/^type /gm, 'export type ')}
${slice(1583, 1596).replace(/^type /gm, 'export type ')}
`
);

write(
  'src/lib/financial/financialLabels.ts',
  `import { CheckCircle2, Clock, AlertCircle, Info } from 'lucide-react';
import { listConferencePaymentWeekdays } from '@/lib/financialCycle';
import type { ApiEntry } from '@/lib/financial/types';
import type { FinancialEntryTypeMeta } from '@/lib/financial/types';

${slice(124, 150)}
${slice(192, 240)}
${slice(761, 768)}
${slice(873, 887).replace('function conferenceDayLabels', 'export function conferenceDayLabels')}
`
);

write(
  'src/lib/financial/entryTypesContext.tsx',
  `'use client';

import { createContext, useContext } from 'react';
import { DEFAULT_TYPE_LABELS, buildTypeLabels } from '@/lib/financial/financialLabels';
import type { EntryTypesCtx } from '@/lib/financial/types';

export { buildTypeLabels };
export type { EntryTypesCtx };

const EntryTypesContext = createContext<EntryTypesCtx>({ types: [], labels: DEFAULT_TYPE_LABELS });

export function EntryTypesProvider({
  value,
  children,
}: {
  value: EntryTypesCtx;
  children: React.ReactNode;
}) {
  return <EntryTypesContext.Provider value={value}>{children}</EntryTypesContext.Provider>;
}

export function useEntryTypes(): EntryTypesCtx {
  return useContext(EntryTypesContext);
}

export function useTypeLabels(): Record<string, string> {
  return useContext(EntryTypesContext).labels;
}
`
);

function write(rel, content) {
  const file = path.join(root, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  console.log('wrote', rel, `(${content.split('\n').length} lines)`);
}

const modalImports = `'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parse, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Info,
  Link2,
  MessageSquare,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { formatBRL } from '@/lib/brFormat';
import { formatDateBr, formatDateTimeBr } from '@/lib/datetimeBr';
import {
  RULE_KIND_LABELS,
  type DiscountRule,
  type DiscountRuleKind,
} from '@/lib/financialCycle';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { buildDefaultRule, WEEK_DAYS } from '@/lib/financial/financialDiscountRules';
import { useEntryTypes, useTypeLabels } from '@/lib/financial/entryTypesContext';
import {
  absenceDispositionLabel,
  coverageRoleLabel,
  entryStatusLabel,
  frequencyLabel,
  inferEntryOrigin,
  occurrenceKindLabel,
  userRoleLabel,
} from '@/lib/financial/financialLabels';
import {
  buildCoverageMaps,
  coverageListHint,
  resolveCoverageAbsence,
  resolveCoverageDailies,
  resolveLinkedEntryId,
} from '@/lib/financial/financialCoverage';
import {
  formatRequestAtSaoPaulo,
  installmentStatusLabel,
  installmentsOnReferenceDate,
} from '@/lib/financial/financialInstallments';
import type { ApiEntry, DriverOption, PharmacyOption } from '@/lib/financial/types';
`;

write(
  'src/components/financial/ImportBillingModal.tsx',
  modalImports +
    '\n' +
    slice(242, 310).replace('function ImportBillingModal', 'export function ImportBillingModal')
);

write(
  'src/components/financial/RecalculateEntriesButton.tsx',
  `'use client';

import { useState } from 'react';
import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';

` + slice(662, 705).replace('function RecalculateEntriesButton', 'export function RecalculateEntriesButton')
);

write(
  'src/components/financial/DiscountRulesModal.tsx',
  modalImports +
    `import { RecalculateEntriesButton } from '@/components/financial/RecalculateEntriesButton';\n\n` +
    slice(312, 660).replace('function DiscountRulesModal', 'export function DiscountRulesModal')
);

write(
  'src/components/financial/ApprovalDrawer.tsx',
  modalImports +
    `import { IconTile } from '@/components/ui/IconTile';\n\n` +
    slice(928, 1596).replace('function ApprovalDrawer', 'export function ApprovalDrawer')
);

write(
  'src/components/financial/NewEntryModal.tsx',
  modalImports +
    '\n' +
    slice(1598, 1846).replace('function NewEntryModal', 'export function NewEntryModal')
);

// Utils block 707-926
write(
  'src/lib/financial/financialDiscountRules.ts',
  `import type { DiscountRule } from '@/lib/financialCycle';
import { DEFAULT_FINANCIAL_DISCOUNT_RULES } from '@/lib/financialCycle';

export const DEFAULT_DISCOUNT_RULES = DEFAULT_FINANCIAL_DISCOUNT_RULES;

export function buildDefaultRule(type: string): DiscountRule {
  return (
    DEFAULT_DISCOUNT_RULES[type] ?? {
      type,
      kind: 'weekly',
      daysOfWeek: [4],
      dayOfMonth: 0,
      monthlyNth: 0,
      monthlyWeekday: 0,
    }
  );
}

export const WEEK_DAYS = [
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
];

` + slice(707, 760)
);

write(
  'src/lib/financial/financialCoverage.ts',
  `import type { ApiEntry, CoverageEntryRef } from '@/lib/financial/types';
import { occurrenceKindLabel, coverageRoleLabel } from '@/lib/financial/financialLabels';

` + slice(770, 871)
);

write(
  'src/lib/financial/financialInstallments.ts',
  `import { format, parseISO } from 'date-fns';
import { formatDateTimeBr } from '@/lib/datetimeBr';
import type { ApiEntry, InstallmentSettlementFilter, InstallmentStatus } from '@/lib/financial/types';

export const SP_TZ = 'America/Sao_Paulo';

` + slice(891, 926)
);

console.log('Extraction complete');

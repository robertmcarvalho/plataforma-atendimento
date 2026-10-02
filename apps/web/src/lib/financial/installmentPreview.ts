import {
  generateInstallmentDueDates,
  getRuleForType,
  mergeDiscountRulesFromJson,
  type DiscountRule,
} from '@/lib/financialCycle';

export type InstallmentPreviewItem = {
  number: number;
  dueDate: string;
  amount: number;
  weekdayLabel: string;
};

export type InstallmentPreviewResult = {
  cycleBaseDate: string;
  firstDiscountDate: string;
  firstDiscountWeekday: string;
  installments: InstallmentPreviewItem[];
};

const WEEKDAY_PT_FULL = [
  'domingo',
  'segunda-feira',
  'terça-feira',
  'quarta-feira',
  'quinta-feira',
  'sexta-feira',
  'sábado',
] as const;

function weekdayLabel(iso: string): string {
  const d = new Date(`${iso}T12:00:00.000Z`);
  return WEEKDAY_PT_FULL[d.getUTCDay()] || iso;
}

export function buildInstallmentPreview(input: {
  entryType: string;
  cycleBaseDate: string;
  installmentsCount: number;
  totalAmount: number;
  frequency?: string;
  discountRules?: Record<string, DiscountRule>;
}): InstallmentPreviewResult | null {
  const cycleBaseDate = String(input.cycleBaseDate || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cycleBaseDate)) return null;

  const count = Math.max(1, input.installmentsCount || 1);
  const amount = Number(input.totalAmount) || 0;
  const installmentAmount = Number((amount / count).toFixed(2));
  const rules = input.discountRules ?? mergeDiscountRulesFromJson(null);
  const rule = getRuleForType(input.entryType, rules);
  const dueDates = generateInstallmentDueDates(
    rule,
    cycleBaseDate,
    count,
    input.frequency || 'weekly'
  );
  if (!dueDates.length) return null;

  const firstDiscountDate = dueDates[0]!;
  return {
    cycleBaseDate,
    firstDiscountDate,
    firstDiscountWeekday: weekdayLabel(firstDiscountDate),
    installments: dueDates.map((dueDate, index) => ({
      number: index + 1,
      dueDate,
      amount: installmentAmount,
      weekdayLabel: weekdayLabel(dueDate),
    })),
  };
}

export function buildAdvanceInstallmentPreview(input: {
  cycleBaseDate: string;
  installmentsCount: number;
  totalAmount: number;
  discountRules?: Record<string, DiscountRule>;
}): InstallmentPreviewResult | null {
  return buildInstallmentPreview({
    entryType: 'advance',
    cycleBaseDate: input.cycleBaseDate,
    installmentsCount: input.installmentsCount,
    totalAmount: input.totalAmount,
    frequency: 'weekly',
    discountRules: input.discountRules,
  });
}

import {
  generateInstallmentDueDates,
  getRuleForType,
  mergeDiscountRulesFromJson,
  type DiscountRule,
} from '@plataforma/financial-cycle';

/** Gera linhas de parcelas para financial_installments (respeita regras de desconto do workspace). */
export function generateInstallments(
  entryId: string,
  startDate: string,
  count: number,
  amount: number,
  frequency: string,
  entryType = 'other',
  discountRules?: Record<string, DiscountRule>
): Array<{
  entry_id: string;
  installment_number: number;
  amount: number;
  due_date: string;
  status: string;
}> {
  const rules = discountRules ?? mergeDiscountRulesFromJson(null);
  const rule = getRuleForType(entryType, rules);
  const dueDates = generateInstallmentDueDates(rule, startDate, count, frequency);

  return dueDates.map((due_date, i) => ({
    entry_id: entryId,
    installment_number: i + 1,
    amount,
    due_date,
    status: 'pending',
  }));
}

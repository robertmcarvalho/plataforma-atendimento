/**
 * Re-export do motor de ciclo (fonte única: @plataforma/financial-cycle).
 */
export {
  DEFAULT_FINANCIAL_DISCOUNT_RULES,
  buildDefaultRuleForType,
  mergeDiscountRulesFromJson,
  resolveDailyPaymentDate,
  resolveAbsencePaymentDate,
  buildAbsenceApuracao,
  summarizeRuleForType,
  previousClosedCycleMonSun,
  type DiscountRule,
  type DiscountRuleKind,
} from '@plataforma/financial-cycle';

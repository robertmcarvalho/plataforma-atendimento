import {
  normalizeDimensionamentoDisplay,
  valorLeadDisplayCents,
} from '@/lib/commercial/commercialFinanceDisplay';
import type { CommercialLead, OperationalDimensioningResult } from '@/lib/commercial/types';

/** Valor lead (12m) para exibição — recalcula a partir do snapshot hidratado. */
export function leadDealValueCents(lead: CommercialLead): number | null {
  const snap = lead.operational_snapshot as OperationalDimensioningResult | null | undefined;
  if (!snap?.perfil_operacao) {
    return lead.deal_value_cents ?? null;
  }
  const norm = normalizeDimensionamentoDisplay(snap);
  const cents = norm.valor_lead_anual_cents ?? valorLeadDisplayCents(norm);
  return cents > 0 ? cents : null;
}

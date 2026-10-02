export type PharmacyAcertoReopenSettlement = { status: string; driver_id?: string };

export type PharmacyAcertoReopenInvoice = {
  pharmacy_id?: string;
  status: string;
  amount_paid_cents?: number | null;
};

export type PharmacyAcertoReopenPayable = {
  beneficiary_id?: string | null;
  origin_type?: string | null;
  status: string;
  amount_paid_cents?: number | null;
};

export type PharmacyAcertoReopenState = {
  visible: boolean;
  enabled: boolean;
  reopenableCount: number;
  disabledReason: string | null;
};

function isPaidLock(status: string, amountPaidCents?: number | null): boolean {
  return String(status) === 'paid' || Number(amountPaidCents || 0) > 0;
}

export function pharmacyAcertoReopenState(input: {
  settlements: PharmacyAcertoReopenSettlement[];
  invoices?: PharmacyAcertoReopenInvoice[];
  payables?: PharmacyAcertoReopenPayable[];
}): PharmacyAcertoReopenState {
  const reopenable = input.settlements.filter(
    (row) => row.status === 'in_review' || row.status === 'approved'
  );
  if (!reopenable.length) {
    return { visible: false, enabled: false, reopenableCount: 0, disabledReason: null };
  }

  if (input.settlements.some((row) => row.status === 'paid')) {
    return {
      visible: true,
      enabled: false,
      reopenableCount: reopenable.length,
      disabledReason: 'Há acerto marcado como pago. Estorno indisponível.',
    };
  }

  const paidInvoice = (input.invoices || []).some((row) => isPaidLock(row.status, row.amount_paid_cents));
  if (paidInvoice) {
    return {
      visible: true,
      enabled: false,
      reopenableCount: reopenable.length,
      disabledReason: 'Há fatura com pagamento/baixa. Estorno indisponível.',
    };
  }

  const driverIds = new Set(
    input.settlements.map((row) => row.driver_id).filter((id): id is string => Boolean(id))
  );
  const paidPayable = (input.payables || []).some((row) => {
    if (row.origin_type !== 'cycle_settlement') return false;
    if (row.beneficiary_id && driverIds.size && !driverIds.has(row.beneficiary_id)) return false;
    return isPaidLock(row.status, row.amount_paid_cents);
  });
  if (paidPayable) {
    return {
      visible: true,
      enabled: false,
      reopenableCount: reopenable.length,
      disabledReason: 'Há título em A pagar com baixa. Estorno indisponível.',
    };
  }

  return {
    visible: true,
    enabled: true,
    reopenableCount: reopenable.length,
    disabledReason: null,
  };
}

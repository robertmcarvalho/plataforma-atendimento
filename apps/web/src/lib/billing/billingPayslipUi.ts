import type { DriverPayslip, DriverPayslipPharmacy } from '@/lib/billing/billingApi';

export function flattenPayslipPharmacies(payslip: DriverPayslip): DriverPayslipPharmacy[] {
  return payslip.cost_centers.flatMap((cc) => cc.pharmacies);
}

export function payslipDeliveryCount(payslip: DriverPayslip): number {
  return flattenPayslipPharmacies(payslip).reduce((sum, ph) => sum + (ph.earnings?.delivery_count || 0), 0);
}

export function payslipAlreadyPaidOrDiscountedCents(payslip: DriverPayslip): number {
  return payslip.totals.dailies_paid_cents + payslip.totals.absences_cents + payslip.totals.discounts_cents;
}

export type PayslipPharmacyRow = {
  id: string;
  name: string;
  deliveryCount: number;
  amountCents: number;
  note: string | null;
};

export function payslipPharmacyRows(payslip: DriverPayslip): PayslipPharmacyRow[] {
  return flattenPayslipPharmacies(payslip).map((ph) => {
    const deliveryCount = ph.earnings?.delivery_count || 0;
    const weeklyDailies = ph.dailies
      .filter((d) => d.pay_track === 'thursday_settlement')
      .reduce((sum, d) => sum + d.amount_cents, 0);
    const amountCents = (ph.earnings?.amount_cents || 0) + weeklyDailies;
    const paidElsewhere = ph.dailies.some((d) => d.pay_track === 'financial_daily' && d.amount_cents > 0);
    const note =
      paidElsewhere && deliveryCount > 0
        ? `${deliveryCount} entregas · pago em outro demonstrativo`
        : deliveryCount > 0
          ? `${deliveryCount} entregas no período`
          : null;
    return {
      id: ph.id,
      name: ph.name,
      deliveryCount,
      amountCents,
      note,
    };
  });
}

export type PayslipOccurrenceRow = {
  key: string;
  label: string;
  amountCents: number;
};

export function payslipOccurrenceRows(payslip: DriverPayslip): PayslipOccurrenceRow[] {
  const rows: PayslipOccurrenceRow[] = [];

  for (const ph of flattenPayslipPharmacies(payslip)) {
    for (const absence of ph.absences) {
      rows.push({
        key: `absence-${ph.id}-${absence.description}-${absence.amount_cents}`,
        label: `${absence.description}${ph.name ? ` · ${ph.name}` : ''}`,
        amountCents: absence.amount_cents,
      });
    }
  }

  for (const discount of payslip.discounts) {
    rows.push({
      key: `discount-${discount.kind}-${discount.description}-${discount.amount_cents}`,
      label: `${discount.label} — ${discount.description}`,
      amountCents: discount.amount_cents,
    });
  }

  for (const daily of payslip.dailies.filter((d) => d.paid)) {
    rows.push({
      key: `daily-${daily.description}-${daily.payment_date}-${daily.amount_cents}`,
      label: `${daily.description}${daily.pharmacy_name ? ` · ${daily.pharmacy_name}` : ''}${
        daily.payment_date ? ` · pago ${daily.payment_date.slice(8, 10)}/${daily.payment_date.slice(5, 7)}` : ''
      }`,
      amountCents: daily.amount_cents,
    });
  }

  return rows;
}

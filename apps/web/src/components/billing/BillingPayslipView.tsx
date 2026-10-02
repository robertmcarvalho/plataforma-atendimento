import {
  BarChart3,
  Building2,
  CalendarDays,
  CheckCircle2,
  Wallet,
} from 'lucide-react';
import type { DriverPayslip } from '@/lib/billing/billingApi';
import { BillingSection } from '@/components/billing/BillingPrimitives';
import { billingKpiDetailClassName, billingKpiLabelClassName, billingKpiValueClassName } from '@/lib/billing/billingReviveUi';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import {
  payslipAlreadyPaidOrDiscountedCents,
  payslipDeliveryCount,
  payslipOccurrenceRows,
  payslipPharmacyRows,
} from '@/lib/billing/billingPayslipUi';
import { cn } from '@/lib/utils';

function Row({
  label,
  value,
  muted,
  negative,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  negative?: boolean;
  strong?: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 text-sm">
      <span className={cn(muted ? 'text-muted-foreground' : 'text-foreground', strong && 'font-semibold')}>{label}</span>
      <span
        className={cn(
          'shrink-0 font-mono tabular-nums',
          negative && 'text-destructive',
          strong && 'font-semibold'
        )}
      >
        {value}
      </span>
    </div>
  );
}

function StatCell({ value, label, negative }: { value: string; label: string; negative?: boolean }) {
  return (
    <div className="text-center">
      <div className={cn('text-sm font-semibold tabular-nums', negative && 'text-destructive')}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

export function BillingPayslipView({ payslip }: { payslip: DriverPayslip }) {
  const deliveryCount = payslipDeliveryCount(payslip);
  const alreadyPaid = payslipAlreadyPaidOrDiscountedCents(payslip);
  const occurrences = payslipOccurrenceRows(payslip);
  const pharmacies = payslipPharmacyRows(payslip);
  const receiveAmount = payslip.pix.amount_cents;
  const receiveLabel = payslip.track === 'daily' ? 'A receber (diária)' : 'A receber';

  return (
    <div className="space-y-4">
      <div className={billingKpiDetailClassName}>
        <div className={billingKpiLabelClassName}>
          {payslip.track === 'daily' ? 'Diária · PIX terça' : 'Acerto semanal · PIX quinta'}
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Valor deste PIX</div>
            <div className={cn(billingKpiValueClassName, 'text-2xl')}>{formatBrlCents(receiveAmount)}</div>
          </div>
          {payslip.pix.payment_date ? (
            <div className="inline-flex items-center gap-1.5 rounded-full border border-success/30 bg-success/10 px-2.5 py-1 text-[11px] font-medium text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              PIX em {fmtDate(payslip.pix.payment_date)}
            </div>
          ) : null}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Período {fmtDate(payslip.cycle.apuracao_start)} a {fmtDate(payslip.cycle.apuracao_end)}
          {payslip.cycle.label ? ` · ${payslip.cycle.label}` : ''}
        </p>
      </div>

      <BillingSection
        title="Composição do acerto"
        desc="Entradas e saídas apuradas no período."
        icon={Wallet}
      >
        <div className="space-y-2">
          <Row
            label={`Entregas realizadas${deliveryCount ? ` · ${deliveryCount} entregas no período` : ''}`}
            value={formatBrlCents(payslip.totals.earnings_cents)}
          />
          {payslip.totals.weekly_dailies_cents > 0 ? (
            <Row
              label="Diária-base de escala"
              value={formatBrlCents(payslip.totals.weekly_dailies_cents)}
            />
          ) : null}
          {occurrences.map((row) => (
            <Row
              key={row.key}
              label={row.label}
              value={`− ${formatBrlCents(row.amountCents)}`}
              muted
              negative
            />
          ))}
          <Row label={receiveLabel} value={formatBrlCents(receiveAmount)} strong />
        </div>
        <div className="grid grid-cols-3 gap-3 border-t border-border pt-3">
          <StatCell value={String(deliveryCount)} label="Entregas" />
          <StatCell value={formatBrlCents(payslip.totals.cycle_total_cents)} label="Total da semana" />
          <StatCell value={formatBrlCents(alreadyPaid)} label="Já pago / descontado" negative={alreadyPaid > 0} />
        </div>
      </BillingSection>

      {pharmacies.length ? (
        <BillingSection
          title="Locais de trabalho"
          desc="Locais em que as entregas foram registradas nesta semana."
          icon={Building2}
        >
          <div className="space-y-2">
            {pharmacies.map((ph) => (
              <div key={ph.id} className="flex items-start justify-between gap-3 text-sm">
                <div>
                  <div className="font-medium">{ph.name}</div>
                  {ph.note ? <div className="text-[11px] text-muted-foreground">{ph.note}</div> : null}
                </div>
                <span className="shrink-0 font-mono tabular-nums">{formatBrlCents(ph.amountCents)}</span>
              </div>
            ))}
          </div>
        </BillingSection>
      ) : null}

      {payslip.recent_weeks?.length ? (
        <BillingSection title="Últimas semanas" desc="Comparação com as semanas anteriores." icon={BarChart3}>
          <div className="flex items-end justify-between gap-2 px-1 pt-2">
            {payslip.recent_weeks.map((week) => {
              const max = Math.max(1, ...payslip.recent_weeks.map((w) => w.amount_cents));
              const height = Math.max(12, Math.round((week.amount_cents / max) * 72));
              return (
                <div key={week.label} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className={cn(
                      'w-full max-w-[3rem] rounded-t-md',
                      week.is_current ? 'bg-primary' : 'bg-muted-foreground/30'
                    )}
                    style={{ height }}
                  />
                  <span className="text-[10px] text-muted-foreground">{week.label}</span>
                </div>
              );
            })}
          </div>
        </BillingSection>
      ) : null}

      <BillingSection
        title="Dados do pagamento"
        desc="Verifique a chave PIX cadastrada."
        icon={CalendarDays}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cooperado</div>
            <div className="mt-1 text-sm font-medium">{payslip.driver.name}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">CPF</div>
            <div className="mt-1 text-sm font-medium">{payslip.driver.cpf_masked}</div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Data do pagamento</div>
            <div className="mt-1 text-sm font-medium">
              {payslip.pix.payment_date ? fmtDate(payslip.pix.payment_date) : '—'}
            </div>
          </div>
          <div className="rounded-lg border border-border bg-background/40 px-3 py-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Chave PIX</div>
            <div className="mt-1 truncate text-sm font-medium">{payslip.driver.pix_key || '—'}</div>
            {payslip.driver.pix_key_type ? (
              <div className="text-[10px] text-muted-foreground">{payslip.driver.pix_key_type.toUpperCase()}</div>
            ) : null}
          </div>
        </div>
      </BillingSection>
    </div>
  );
}

import { formatBrlCents } from '@/lib/billing/billingFormat';
import { Bike, ChartNoAxesColumn } from 'lucide-react';
import { redirect } from 'next/navigation';

type InvoiceLine = {
  description: string;
  amount_cents: number;
  metadata?: Record<string, unknown> & {
    daily_lines?: {
      description?: string;
      total_amount_cents?: number;
      entity_amount_cents?: number;
      financial_entry_id?: string | null;
      allocation_rule?: string | null;
      group_id?: string | null;
      group_name?: string | null;
    }[];
  };
};

type ReportPayload = {
  invoice: {
    entity_type: string;
    total_cents: number;
    status: string;
    due_date: string | null;
    public_token: string;
    pharmacies?: { trade_name?: string; legal_name?: string; cnpj?: string } | null;
    billing_cycles?: { label?: string; apuracao_start: string; apuracao_end: string } | null;
    billing_invoice_lines?: InvoiceLine[];
  };
  companion_invoice?: {
    entity_type: 'flux';
    total_cents: number;
    amount_paid_cents: number;
    status: string;
    due_date: string | null;
    public_token: string;
    billing_invoice_lines?: InvoiceLine[];
  } | null;
  cycle_comparison?: {
    previous_cycles: {
      id: string;
      label?: string | null;
      apuracao_start: string;
      apuracao_end: string;
      delivery_count: number;
      total_cents: number;
      driver_count: number;
      minimum_guaranteed_count: number;
    }[];
  };
  redirect_token?: string;
  public_report_blocked?: boolean;
  deliveries: {
    delivered_at: string;
    document_number?: string;
    drivers?: { name?: string } | null;
    pharmacies?: { trade_name?: string; legal_name?: string } | null;
  }[];
  delivery_filters?: {
    date: string | null;
    driver_id: string | null;
    pharmacy_id: string | null;
    page: number;
    limit: number;
    total: number;
    total_pages: number;
    days: string[];
    drivers: { id: string; name: string }[];
    pharmacies: { id: string; name: string }[];
  };
  legal_entity?: { legal_name?: string; trade_name?: string; cnpj?: string } | null;
};

function formatDateBr(iso?: string | null) {
  if (!iso) return '—';
  const raw = String(iso).slice(0, 10);
  const [year, month, day] = raw.split('-');
  return year && month && day ? `${day}/${month}/${year}` : raw;
}

function formatDateTimeBr(iso?: string | null) {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: 'America/Sao_Paulo',
  }).format(new Date(iso));
}

function numberFromMetadata(metadata: Record<string, unknown> | undefined, key: string): number | null {
  const value = metadata?.[key];
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function driverNameFromDescription(description: string): string {
  return description.split('—')[0]?.trim() || 'Entregador';
}

function lineKey(line: InvoiceLine, index: number): string {
  const settlementId = line.metadata?.settlement_id;
  if (settlementId) return `settlement:${String(settlementId)}`;
  const driverId = line.metadata?.driver_id;
  if (driverId) return `driver:${String(driverId)}`;
  return `index:${index}`;
}

function percentOf(part: number, total: number): number {
  if (total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((part / total) * 100)));
}

function compactCycleLabel(label?: string | null, endIso?: string | null): string {
  if (label) return label.replace(/^ATIVMOB\s*/i, '').replace(/\s+/g, ' ').trim();
  if (!endIso) return 'Atual';
  const raw = String(endIso).slice(0, 10);
  const [, month, day] = raw.split('-');
  return day && month ? `${day}/${month}` : raw;
}

function shortDriverName(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

async function loadReport(
  token: string,
  filters: { date?: string; driver_id?: string; pharmacy_id?: string; page?: string }
): Promise<ReportPayload | null> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const params = new URLSearchParams();
    if (filters.date) params.set('date', filters.date);
    if (filters.driver_id) params.set('driver_id', filters.driver_id);
    if (filters.pharmacy_id) params.set('pharmacy_id', filters.pharmacy_id);
    if (filters.page) params.set('page', filters.page);
    const query = params.toString();
    const res = await fetch(`${base}/api/public/billing/reports/${token}${query ? `?${query}` : ''}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as ReportPayload;
  } catch {
    return null;
  }
}

export default async function PublicBillingReportPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ date?: string; driver_id?: string; pharmacy_id?: string; page?: string }>;
}) {
  const { token } = await params;
  const filters = await searchParams;
  const data = await loadReport(token, filters);

  if (data?.redirect_token && data.redirect_token !== token) {
    redirect(`/public/billing/${data.redirect_token}`);
  }

  if (!data || data.public_report_blocked) {
    return (
      <main className="mx-auto max-w-3xl p-8 text-center text-sm text-muted-foreground">
        Relatório não encontrado ou indisponível para envio à farmácia.
      </main>
    );
  }

  const { invoice, deliveries, legal_entity: entity } = data;
  const fluxInvoice = data.companion_invoice;
  const pharmacy = invoice.pharmacies;
  const cycle = invoice.billing_cycles;
  const invoiceLines = invoice.billing_invoice_lines || [];
  const companionLines = fluxInvoice?.billing_invoice_lines || [];
  const deliveryFilters = data.delivery_filters;
  const selectedPharmacyId = deliveryFilters?.pharmacy_id || '';
  const filteredInvoiceLines = selectedPharmacyId
    ? invoiceLines.filter((line) => String(line.metadata?.source_pharmacy_id || '') === selectedPharmacyId)
    : invoiceLines;
  const companionLineByKey = new Map(companionLines.map((line, index) => [lineKey(line, index), line]));
  const driverCards = filteredInvoiceLines.map((line, index) => {
    const companionLine = companionLineByKey.get(lineKey(line, index));
    return {
      line,
      companionLine,
      totalAmountCents: Number(line.amount_cents) + Number(companionLine?.amount_cents || 0),
    };
  });
  const dailyChargeRows = filteredInvoiceLines.flatMap((line) => {
    const sourcePharmacyName = String(line.metadata?.source_pharmacy_name || '');
    const driverName = driverNameFromDescription(line.description);
    return (line.metadata?.daily_lines || []).map((daily, index) => ({
      key: `${lineKey(line, index)}:${daily.financial_entry_id || index}`,
      sourcePharmacyName,
      driverName,
      description: daily.description || 'Diária',
      groupName: daily.group_name || null,
      totalAmountCents: Number(daily.total_amount_cents || 0),
    }));
  });
  const dailyChargeTotalCents = dailyChargeRows.reduce((sum, row) => sum + row.totalAmountCents, 0);
  const filteredCoopTotalCents = filteredInvoiceLines.reduce((sum, line) => sum + Number(line.amount_cents || 0), 0);
  const filteredFluxTotalCents = selectedPharmacyId
    ? filteredInvoiceLines.reduce((sum, line, index) => {
        const companionLine = companionLineByKey.get(lineKey(line, index));
        return sum + Number(companionLine?.amount_cents || 0);
      }, 0)
    : fluxInvoice?.total_cents || 0;
  const displayCoopTotalCents = selectedPharmacyId ? filteredCoopTotalCents : invoice.total_cents;
  const displayFluxTotalCents = selectedPharmacyId ? filteredFluxTotalCents : fluxInvoice?.total_cents || 0;
  const displayTotalGeralCents = displayCoopTotalCents + displayFluxTotalCents;
  const selectedPharmacyName =
    selectedPharmacyId && deliveryFilters?.pharmacies
      ? deliveryFilters.pharmacies.find((item) => item.id === selectedPharmacyId)?.name
      : null;
  const invoiceDeliveryTotal = filteredInvoiceLines.reduce((sum, line) => sum + (numberFromMetadata(line.metadata, 'delivery_count') || 0), 0);
  const deliveryTotal = invoiceDeliveryTotal || deliveryFilters?.total || 0;
  const driverTotal = driverCards.length;
  const comparisonRows = [
    ...(data.cycle_comparison?.previous_cycles || []),
    {
      id: String(cycle?.label || 'current'),
      label: cycle?.label || 'Ciclo atual',
      apuracao_start: cycle?.apuracao_start || '',
      apuracao_end: cycle?.apuracao_end || '',
      delivery_count: deliveryTotal,
      total_cents: displayTotalGeralCents,
      driver_count: driverTotal,
      minimum_guaranteed_count: driverCards.filter((card) => card.line.metadata?.applied_mg === true).length,
    },
  ];
  const chartRows = comparisonRows.slice(-4);
  const maxComparisonTotal = Math.max(1, ...comparisonRows.map((row) => row.total_cents));
  const maxComparisonDeliveries = Math.max(1, ...comparisonRows.map((row) => row.delivery_count));
  const driverDistribution = driverCards
    .map((card) => ({
      name: driverNameFromDescription(card.line.description),
      deliveries: numberFromMetadata(card.line.metadata, 'delivery_count') || 0,
    }))
    .sort((a, b) => b.deliveries - a.deliveries);
  const distributionTotal = driverDistribution.reduce((sum, row) => sum + row.deliveries, 0) || 1;
  const donutColors = ['var(--primary)', 'var(--success)', 'var(--warning)', 'var(--channel-whatsapp)', 'var(--channel-instagram)', 'var(--muted-foreground)'];
  const donutStops = driverDistribution
    .reduce<{ cursor: number; stops: string[] }>(
      (acc, row, index) => {
        const start = acc.cursor;
        const end = start + (row.deliveries / distributionTotal) * 100;
        return {
          cursor: end,
          stops: [...acc.stops, `${donutColors[index % donutColors.length]} ${start}% ${end}%`],
        };
      },
      { cursor: 0, stops: [] }
    )
    .stops.join(', ');
  const currentPage = deliveryFilters?.page || 1;
  const totalPages = deliveryFilters?.total_pages || 1;
  const basePagePath = `/public/billing/${token}`;
  const pageHref = (page: number) => {
    const params = new URLSearchParams();
    if (deliveryFilters?.date) params.set('date', deliveryFilters.date);
    if (deliveryFilters?.driver_id) params.set('driver_id', deliveryFilters.driver_id);
    if (deliveryFilters?.pharmacy_id) params.set('pharmacy_id', deliveryFilters.pharmacy_id);
    params.set('page', String(page));
    return `${basePagePath}?${params.toString()}`;
  };

  return (
    <main className="min-h-screen bg-background py-6 font-sans text-foreground print:bg-white print:py-0">
      <article className="mx-auto max-w-4xl rounded-lg border border-border bg-surface px-8 py-7 shadow-sm print:max-w-none print:rounded-none print:border-0 print:bg-white print:p-0 print:shadow-none">
        <header className="border-b border-border pb-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Relatório de faturamento</p>
              <h1 className="mt-1 text-2xl font-bold tracking-tight">
                {entity?.trade_name || entity?.legal_name || 'Faturamento'}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">CNPJ {entity?.cnpj || '—'}</p>
            </div>
            <div className="rounded-lg border border-primary/20 bg-primary/10 px-4 py-2 text-right">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Resumo financeiro</p>
              <p className="mt-1 text-xs text-muted-foreground">CoopMob com resumo Flux Farma</p>
            </div>
          </div>
        </header>

        <section className="mt-6 grid gap-4 text-sm lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-lg border border-border bg-background/50 p-4">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Dados da apuração</h2>
            <dl className="mt-3 grid gap-2">
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Farmácia:</dt>
                <dd className="font-medium">
                  {selectedPharmacyName || pharmacy?.trade_name || pharmacy?.legal_name || '—'}
                  {selectedPharmacyName ? <span className="ml-2 text-xs font-normal text-muted-foreground">(filtro aplicado)</span> : null}
                </dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-28 shrink-0 text-muted-foreground">Ciclo:</dt>
                <dd>{cycle?.label || `${formatDateBr(cycle?.apuracao_start)} a ${formatDateBr(cycle?.apuracao_end)}`}</dd>
              </div>
              {cycle?.apuracao_start && cycle?.apuracao_end ? (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Período:</dt>
                  <dd>
                    {formatDateBr(cycle.apuracao_start)} a {formatDateBr(cycle.apuracao_end)}
                  </dd>
                </div>
              ) : null}
              {invoice.due_date ? (
                <div className="flex gap-2">
                  <dt className="w-28 shrink-0 text-muted-foreground">Vencimento:</dt>
                  <dd>{formatDateBr(invoice.due_date)}</dd>
                </div>
              ) : null}
            </dl>
          </div>

          <div className="rounded-lg border border-border bg-surface-elevated p-4 shadow-sm">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Resumo de cobrança</h2>
            <div className="mt-3 space-y-2 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Fatura CoopMob</span>
                <strong className="font-mono">{formatBrlCents(displayCoopTotalCents)}</strong>
              </div>
              {fluxInvoice ? (
                <div className="flex items-start justify-between gap-3 rounded-lg bg-primary/10 px-3 py-2 text-primary ring-1 ring-primary/20">
                  <span>
                    <span className="block font-medium">Parcela Flux Farma</span>
                    <span className="text-[11px] text-primary/80">Valor informado no relatório CoopMob</span>
                  </span>
                  <strong className="font-mono">{formatBrlCents(displayFluxTotalCents)}</strong>
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-2">
                <span className="font-semibold">Total geral do ciclo</span>
                <strong className="font-mono text-base">{formatBrlCents(displayTotalGeralCents)}</strong>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-7 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-surface-elevated p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <ChartNoAxesColumn className="h-4 w-4 text-primary" />
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Faturamento e entregas (ciclos)
              </h2>
            </div>
            <div className="mt-5 flex h-52 items-end gap-4 border-b border-l border-border px-3 pb-6">
              {chartRows.map((row) => {
                const revenueHeight = Math.max(6, percentOf(row.total_cents, maxComparisonTotal));
                const deliveryHeight = Math.max(6, percentOf(row.delivery_count, maxComparisonDeliveries));
                return (
                  <div key={`bar-${row.id}`} className="flex flex-1 flex-col items-center justify-end gap-2">
                    <div className="flex h-36 items-end gap-1.5">
                      <div
                        className="w-5 rounded-sm bg-primary"
                        title={`Faturamento: ${formatBrlCents(row.total_cents)}`}
                        style={{ height: `${revenueHeight}%` }}
                      />
                      <div
                        className="w-5 rounded-sm bg-success"
                        title={`Entregas: ${row.delivery_count.toLocaleString('pt-BR')}`}
                        style={{ height: `${deliveryHeight}%` }}
                      />
                    </div>
                    <span className="max-w-20 truncate text-[10px] font-semibold text-muted-foreground">
                      {compactCycleLabel(row.label, row.apuracao_end)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 flex flex-wrap gap-4 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-primary" /> Faturamento
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2.5 w-2.5 rounded-sm bg-success" /> Entregas
              </span>
            </div>
          </div>

          <div className="rounded-lg border border-border bg-surface-elevated p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <ChartNoAxesColumn className="h-4 w-4 text-primary" />
              <h2 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                Distribuição de entregas por entregador
              </h2>
            </div>
            <div className="mt-5 grid items-center gap-5 md:grid-cols-[180px_1fr]">
              <div
                className="relative mx-auto h-40 w-40 rounded-full"
                style={{ background: donutStops ? `conic-gradient(${donutStops})` : 'var(--muted)' }}
              >
                <div className="absolute inset-10 rounded-full border border-border bg-surface-elevated" />
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="text-center">
                    <div className="font-mono text-lg font-bold">{deliveryTotal.toLocaleString('pt-BR')}</div>
                    <div className="text-[10px] uppercase tracking-wide text-muted-foreground">entregas</div>
                  </div>
                </div>
              </div>
              <div className="grid gap-2 text-[11px]">
                {driverDistribution.slice(0, 6).map((row, index) => (
                  <div key={row.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2">
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-sm"
                        style={{ background: donutColors[index % donutColors.length] }}
                      />
                      <span className="truncate">{shortDriverName(row.name)}</span>
                    </span>
                    <span className="font-mono text-muted-foreground">{percentOf(row.deliveries, distributionTotal)}%</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {dailyChargeRows.length ? (
          <section className="mt-8">
            <div className="flex items-end justify-between gap-4 border-b border-border pb-2">
              <div>
                <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-muted-foreground">Diárias cobradas</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Diárias incluídas na cobrança do ciclo, com farmácia operacional, entregador e grupo de rateio quando aplicável.
                </p>
              </div>
              <strong className="font-mono text-sm">{formatBrlCents(dailyChargeTotalCents)}</strong>
            </div>
            <div className="mt-3 overflow-hidden rounded-lg border border-border">
              <table className="w-full text-xs">
                <thead className="bg-background/60 text-left text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2">Farmácia</th>
                    <th className="px-3 py-2">Entregador</th>
                    <th className="px-3 py-2">Descrição</th>
                    <th className="px-3 py-2">Grupo</th>
                    <th className="px-3 py-2 text-right">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyChargeRows.map((row) => (
                    <tr key={row.key} className="border-t border-border/60">
                      <td className="px-3 py-2">{row.sourcePharmacyName || '—'}</td>
                      <td className="px-3 py-2">{row.driverName}</td>
                      <td className="px-3 py-2">{row.description}</td>
                      <td className="px-3 py-2">{row.groupName || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono">{formatBrlCents(row.totalAmountCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

        <section className="mt-8">
          <div className="flex items-end justify-between gap-4 border-b border-border pb-2">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-muted-foreground">Cartões dos entregadores</h2>
              <p className="mt-1 text-xs text-muted-foreground">Comparativo entre entregas realizadas, mínimo contratado e valor faturado.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            {driverCards.map((card, i) => {
              const { line, companionLine, totalAmountCents } = card;
              const deliveriesCount = numberFromMetadata(line.metadata, 'delivery_count');
              const minimumCount = numberFromMetadata(line.metadata, 'minimum_deliveries_count');
              const mgApplied = line.metadata?.applied_mg === true;
              const progress =
                deliveriesCount != null && minimumCount && minimumCount > 0
                  ? Math.min(100, Math.round((deliveriesCount / minimumCount) * 100))
                  : null;

              return (
                <article key={i} className="rounded-lg border border-border bg-surface-elevated p-4 shadow-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex gap-3">
                      <span className="mt-0.5 rounded-md bg-primary/10 p-2 text-primary">
                        <Bike className="h-4 w-4" />
                      </span>
                      <div>
                        <h3 className="text-sm font-bold uppercase tracking-tight">{driverNameFromDescription(line.description)}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {deliveriesCount != null ? `${deliveriesCount.toLocaleString('pt-BR')} entregas realizadas` : 'Entregas não informadas'}
                          {minimumCount ? ` · mínimo contratado ${minimumCount.toLocaleString('pt-BR')}` : ''}
                        </p>
                      </div>
                    </div>
                    {mgApplied ? (
                      <span className="shrink-0 rounded-md bg-warning/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-warning ring-1 ring-warning/20">
                        Mínimo garantido
                      </span>
                    ) : null}
                  </div>

                  {progress != null ? (
                    <div className="mt-4">
                      <div className="mb-1 flex justify-between text-[11px] text-muted-foreground">
                        <span>Realizado x mínimo</span>
                        <span>{progress}%</span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-md bg-muted">
                        <div className="h-full rounded-sm bg-primary" style={{ width: `${progress}%` }} />
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 flex items-center justify-between border-t border-border pt-3">
                    <span className="text-xs font-medium text-muted-foreground">
                      Valor faturado{companionLine ? ' (CoopMob + Flux Farma)' : ''}
                    </span>
                    <strong className="font-mono text-base">{formatBrlCents(totalAmountCents)}</strong>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="mt-8">
          <div className="flex items-end justify-between gap-4">
            <div>
              <h2 className="text-sm font-bold uppercase tracking-[0.14em] text-muted-foreground">Entregas do período</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Exibindo no máximo {deliveryFilters?.limit || 50} entregas por página
                {deliveryFilters ? ` de ${deliveryFilters.total} encontrada(s)` : ''}.
              </p>
            </div>
          </div>
          <form
            action={basePagePath}
            className="mt-3 grid gap-3 rounded-lg border border-border bg-surface-elevated p-3 text-xs shadow-sm md:grid-cols-[1fr_1fr_1fr_auto]"
          >
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground">Farmácia</span>
              <select
                name="pharmacy_id"
                defaultValue={deliveryFilters?.pharmacy_id || ''}
                className="h-9 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
              >
                <option value="">Todas as farmácias do centro de custo</option>
                {(deliveryFilters?.pharmacies || []).map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground">Dia</span>
              <select
                name="date"
                defaultValue={deliveryFilters?.date || ''}
                className="h-9 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
              >
                <option value="">Todos os dias</option>
                {(deliveryFilters?.days || []).map((day) => (
                  <option key={day} value={day}>
                    {formatDateBr(day)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="font-medium text-muted-foreground">Entregador</span>
              <select
                name="driver_id"
                defaultValue={deliveryFilters?.driver_id || ''}
                className="h-9 rounded-md border border-border bg-background px-3 text-foreground outline-none focus:border-primary"
              >
                <option value="">Todos os entregadores</option>
                {(deliveryFilters?.drivers || []).map((driver) => (
                  <option key={driver.id} value={driver.id}>
                    {driver.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end gap-2">
              <button type="submit" className="h-9 rounded-md bg-primary px-4 font-semibold text-primary-foreground">
                Filtrar
              </button>
              <a href={basePagePath} className="inline-flex h-9 items-center rounded-md border border-border px-4 font-medium text-foreground">
                Limpar
              </a>
            </div>
          </form>
          <div className="mt-3 overflow-hidden rounded-lg border border-border">
            <table className="w-full text-xs">
              <thead className="bg-background/60 text-left text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Data</th>
                  <th className="px-3 py-2">Farmácia</th>
                  <th className="px-3 py-2">Entregador</th>
                  <th className="px-3 py-2 text-right">Doc.</th>
                </tr>
              </thead>
              <tbody>
                {deliveries.map((d, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-3 py-2">{formatDateTimeBr(d.delivered_at)}</td>
                    <td className="px-3 py-2">{d.pharmacies?.trade_name || d.pharmacies?.legal_name || '—'}</td>
                    <td className="px-3 py-2">{d.drivers?.name || '—'}</td>
                    <td className="px-3 py-2 text-right font-mono">{d.document_number || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {totalPages > 1 ? (
            <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
              <span>
                Página {currentPage} de {totalPages}
              </span>
              <div className="flex gap-2">
                {currentPage > 1 ? (
                  <a href={pageHref(currentPage - 1)} className="rounded-md border border-border px-3 py-1.5 text-foreground">
                    Anterior
                  </a>
                ) : null}
                {currentPage < totalPages ? (
                  <a href={pageHref(currentPage + 1)} className="rounded-md border border-border px-3 py-1.5 text-foreground">
                    Próxima
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </article>
    </main>
  );
}

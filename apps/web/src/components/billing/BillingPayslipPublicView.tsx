'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import Image from 'next/image';
import { BarChart3, Building2, CalendarDays, CheckCircle2, Copy, Moon, Sun, Wallet } from 'lucide-react';
import type { DriverPayslip } from '@/lib/billing/billingApi';
import { formatBrlCents, fmtDate } from '@/lib/billing/billingFormat';
import {
  payslipAlreadyPaidOrDiscountedCents,
  payslipDeliveryCount,
  payslipOccurrenceRows,
  payslipPharmacyRows,
} from '@/lib/billing/billingPayslipUi';
import { formatBrazilPhone } from '@/lib/brFormat';
import { cn } from '@/lib/utils';

export type ReciboTheme = 'light' | 'dark';

const THEME_STORAGE_KEY = 'billing_recibo_theme';

function resolveInitialTheme(): ReciboTheme {
  if (typeof window === 'undefined') return 'dark';
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    /* ignore */
  }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

function PublicCard({
  title,
  desc,
  icon: Icon,
  iconClassName,
  children,
  theme,
}: {
  title: string;
  desc: string;
  icon: typeof Wallet;
  iconClassName: string;
  children: ReactNode;
  theme: ReciboTheme;
}) {
  const dark = theme === 'dark';
  return (
    <section
      className={cn(
        'rounded-2xl border p-4 sm:p-5',
        dark ? 'border-white/10 bg-[#141414]' : 'border-zinc-200 bg-white shadow-sm'
      )}
    >
      <div className="mb-4 flex items-start gap-3">
        <div className={cn('flex h-9 w-9 shrink-0 items-center justify-center rounded-xl', iconClassName)}>
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
        <div>
          <h2 className={cn('text-sm font-semibold', dark ? 'text-white' : 'text-zinc-900')}>{title}</h2>
          <p className={cn('mt-0.5 text-xs', dark ? 'text-white/55' : 'text-zinc-500')}>{desc}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function PublicRow({
  label,
  sublabel,
  value,
  negative,
  strong,
  theme,
}: {
  label: string;
  sublabel?: string;
  value: string;
  negative?: boolean;
  strong?: boolean;
  theme: ReciboTheme;
}) {
  const dark = theme === 'dark';
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <div>
        <div
          className={cn(
            strong ? 'font-semibold' : null,
            dark ? (strong ? 'text-white' : 'text-white/90') : strong ? 'text-zinc-900' : 'text-zinc-800'
          )}
        >
          {label}
        </div>
        {sublabel ? (
          <div className={cn('text-[11px]', dark ? 'text-white/45' : 'text-zinc-500')}>{sublabel}</div>
        ) : null}
      </div>
      <span
        className={cn(
          'shrink-0 font-mono tabular-nums',
          negative ? (dark ? 'text-red-400' : 'text-red-600') : dark ? 'text-white' : 'text-zinc-900',
          strong && 'font-semibold'
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function BillingPayslipPublicView({
  payslip,
  pdfHrefBase,
}: {
  payslip: DriverPayslip;
  /** Base PDF URL without theme query (theme appended client-side). */
  pdfHrefBase: string;
}) {
  const [theme, setTheme] = useState<ReciboTheme>('dark');
  const [copied, setCopied] = useState(false);
  const deliveryCount = payslipDeliveryCount(payslip);
  const alreadyPaid = payslipAlreadyPaidOrDiscountedCents(payslip);
  const occurrences = payslipOccurrenceRows(payslip);
  const pharmacies = payslipPharmacyRows(payslip);
  const receiveAmount = payslip.pix.amount_cents;
  const supportPhone = payslip.support_phone?.trim() || null;
  const supportPhoneLabel = supportPhone ? formatBrazilPhone(supportPhone) || supportPhone : null;
  const dark = theme === 'dark';

  useEffect(() => {
    setTheme(resolveInitialTheme());
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
  }, [theme]);

  const pdfHref = useMemo(() => {
    const sep = pdfHrefBase.includes('?') ? '&' : '?';
    return `${pdfHrefBase}${sep}theme=${theme}`;
  }, [pdfHrefBase, theme]);

  const copyPix = async () => {
    if (!payslip.driver.pix_key) return;
    await navigator.clipboard.writeText(payslip.driver.pix_key);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  return (
    <div
      className={cn(
        'min-h-screen font-sans',
        dark ? 'bg-[#0a0a0a] text-white' : 'bg-zinc-100 text-zinc-900',
        'print:bg-white print:text-black'
      )}
    >
      <div className="mx-auto max-w-lg space-y-4 px-4 py-6 sm:px-0">
        <header className="space-y-4 pb-2">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Image src="/branding/aethera-mark.svg" alt="CoopMob" width={28} height={28} className="h-7 w-7" />
              <span className={cn('text-sm font-semibold tracking-wide', dark ? 'text-white' : 'text-zinc-900')}>
                COOPMOB
              </span>
            </div>
            <div className="flex items-center gap-2 print:hidden">
              <button
                type="button"
                onClick={toggleTheme}
                aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}
                className={cn(
                  'inline-flex h-8 w-8 items-center justify-center rounded-lg border',
                  dark
                    ? 'border-white/15 text-white/80 hover:bg-white/5'
                    : 'border-zinc-300 text-zinc-600 hover:bg-zinc-200/70'
                )}
              >
                {dark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
              </button>
              <a
                href={pdfHref}
                className={cn(
                  'inline-flex h-8 items-center rounded-lg border px-3 text-xs font-medium',
                  dark
                    ? 'border-white/15 text-white/80 hover:bg-white/5'
                    : 'border-zinc-300 text-zinc-700 hover:bg-zinc-200/70'
                )}
              >
                Baixar PDF
              </a>
            </div>
          </div>
          <div>
            <h1 className={cn('text-2xl font-bold tracking-tight', dark ? 'text-white' : 'text-zinc-900')}>
              Seu pagamento da semana
            </h1>
            <p className={cn('mt-1 text-sm', dark ? 'text-white/55' : 'text-zinc-500')}>
              Período de {fmtDate(payslip.cycle.apuracao_start)} a {fmtDate(payslip.cycle.apuracao_end)}
            </p>
          </div>
          <div>
            <div
              className={cn(
                'text-[10px] font-semibold uppercase tracking-[0.18em]',
                dark ? 'text-white/45' : 'text-zinc-500'
              )}
            >
              Você vai receber
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-3">
              <div className={cn('text-4xl font-bold tracking-tight', dark ? 'text-white' : 'text-zinc-900')}>
                {formatBrlCents(receiveAmount)}
              </div>
              {payslip.pix.payment_date ? (
                <div
                  className={cn(
                    'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium',
                    dark
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
                      : 'border-emerald-600/25 bg-emerald-50 text-emerald-700'
                  )}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  PIX em {fmtDate(payslip.pix.payment_date)}
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <PublicCard
          theme={theme}
          title="Como chegamos nesse valor"
          desc="Conta simples do que entrou e do que saiu na semana."
          icon={Wallet}
          iconClassName={dark ? 'bg-sky-500/15 text-sky-400' : 'bg-sky-100 text-sky-700'}
        >
          <PublicRow
            theme={theme}
            label="Entregas realizadas"
            sublabel={deliveryCount ? `${deliveryCount} entregas no período` : undefined}
            value={formatBrlCents(payslip.totals.earnings_cents)}
          />
          {payslip.totals.weekly_dailies_cents > 0 ? (
            <PublicRow
              theme={theme}
              label="Diária-base de escala"
              value={formatBrlCents(payslip.totals.weekly_dailies_cents)}
            />
          ) : null}
          {occurrences.map((row) => (
            <PublicRow
              key={row.key}
              theme={theme}
              label={row.label}
              value={`− ${formatBrlCents(row.amountCents)}`}
              negative
            />
          ))}
          <PublicRow theme={theme} label="Você vai receber" value={formatBrlCents(receiveAmount)} strong />
          <div
            className={cn(
              'mt-3 grid grid-cols-3 gap-2 border-t pt-3',
              dark ? 'border-white/10' : 'border-zinc-200'
            )}
          >
            <div className="text-center">
              <div className={cn('text-sm font-semibold', dark ? 'text-white' : 'text-zinc-900')}>{deliveryCount}</div>
              <div className={cn('text-[10px]', dark ? 'text-white/45' : 'text-zinc-500')}>Entregas</div>
            </div>
            <div className="text-center">
              <div className={cn('text-sm font-semibold', dark ? 'text-white' : 'text-zinc-900')}>
                {formatBrlCents(payslip.totals.cycle_total_cents)}
              </div>
              <div className={cn('text-[10px]', dark ? 'text-white/45' : 'text-zinc-500')}>Total da semana</div>
            </div>
            <div className="text-center">
              <div
                className={cn(
                  'text-sm font-semibold',
                  alreadyPaid > 0
                    ? dark
                      ? 'text-red-400'
                      : 'text-red-600'
                    : dark
                      ? 'text-white'
                      : 'text-zinc-900'
                )}
              >
                {formatBrlCents(alreadyPaid)}
              </div>
              <div className={cn('text-[10px]', dark ? 'text-white/45' : 'text-zinc-500')}>Já pago / descontado</div>
            </div>
          </div>
        </PublicCard>

        {pharmacies.length ? (
          <PublicCard
            theme={theme}
            title="Onde você trabalhou"
            desc="Locais em que suas entregas foram registradas nesta semana."
            icon={Building2}
            iconClassName={dark ? 'bg-pink-500/15 text-pink-400' : 'bg-pink-100 text-pink-700'}
          >
            <div className="space-y-2">
              {pharmacies.map((ph) => (
                <PublicRow
                  key={ph.id}
                  theme={theme}
                  label={ph.name}
                  sublabel={ph.note || undefined}
                  value={formatBrlCents(ph.amountCents)}
                />
              ))}
            </div>
          </PublicCard>
        ) : null}

        {payslip.recent_weeks?.length ? (
          <PublicCard
            theme={theme}
            title="Suas últimas semanas"
            desc="Comparação com as semanas anteriores."
            icon={BarChart3}
            iconClassName={dark ? 'bg-emerald-500/15 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}
          >
            <div className="flex items-end justify-between gap-2 px-1 pt-2">
              {payslip.recent_weeks.map((week) => {
                const max = Math.max(1, ...payslip.recent_weeks.map((w) => w.amount_cents));
                const height = Math.max(12, Math.round((week.amount_cents / max) * 80));
                return (
                  <div key={week.label} className="flex flex-1 flex-col items-center gap-1.5">
                    <div
                      className={cn(
                        'w-full max-w-[3rem] rounded-t-md',
                        week.is_current ? 'bg-sky-500' : dark ? 'bg-white/20' : 'bg-zinc-300'
                      )}
                      style={{ height }}
                    />
                    <span className={cn('text-[10px]', dark ? 'text-white/45' : 'text-zinc-500')}>{week.label}</span>
                  </div>
                );
              })}
            </div>
          </PublicCard>
        ) : null}

        <PublicCard
          theme={theme}
          title="Dados do pagamento"
          desc="Confira se está tudo certo com a sua chave PIX."
          icon={CalendarDays}
          iconClassName={dark ? 'bg-sky-500/15 text-sky-400' : 'bg-sky-100 text-sky-700'}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              { label: 'Cooperado', value: payslip.driver.name },
              { label: 'CPF', value: payslip.driver.cpf_masked },
              {
                label: 'Data do pagamento',
                value: payslip.pix.payment_date ? fmtDate(payslip.pix.payment_date) : '—',
              },
            ].map((field) => (
              <div
                key={field.label}
                className={cn(
                  'rounded-xl border px-3 py-2.5',
                  dark ? 'border-white/10 bg-black/30' : 'border-zinc-200 bg-zinc-50'
                )}
              >
                <div
                  className={cn(
                    'text-[10px] font-semibold uppercase tracking-wider',
                    dark ? 'text-white/45' : 'text-zinc-500'
                  )}
                >
                  {field.label}
                </div>
                <div className={cn('mt-1 text-sm font-medium', dark ? 'text-white' : 'text-zinc-900')}>
                  {field.value}
                </div>
              </div>
            ))}
            <div
              className={cn(
                'rounded-xl border px-3 py-2.5',
                dark ? 'border-white/10 bg-black/30' : 'border-zinc-200 bg-zinc-50'
              )}
            >
              <div
                className={cn(
                  'text-[10px] font-semibold uppercase tracking-wider',
                  dark ? 'text-white/45' : 'text-zinc-500'
                )}
              >
                Chave PIX
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className={cn('truncate text-sm font-medium', dark ? 'text-white' : 'text-zinc-900')}>
                  {payslip.driver.pix_key || '—'}
                </span>
                {payslip.driver.pix_key ? (
                  <button
                    type="button"
                    onClick={copyPix}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10px]',
                      dark
                        ? 'border-white/15 text-white/70 hover:bg-white/5'
                        : 'border-zinc-300 text-zinc-600 hover:bg-zinc-100'
                    )}
                  >
                    <Copy className="h-3 w-3" />
                    {copied ? 'Copiado' : 'Copiar'}
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </PublicCard>

        <footer
          className={cn(
            'space-y-2 px-1 pb-8 pt-2 text-center text-xs',
            dark ? 'text-white/45' : 'text-zinc-500'
          )}
        >
          <p>
            Alguma dúvida sobre esses valores?{' '}
            {supportPhoneLabel ? `Fale com a CoopMob pelo ${supportPhoneLabel}.` : 'Fale com a CoopMob.'}
          </p>
          <p className={cn('text-[11px]', dark ? 'text-white/30' : 'text-zinc-400')}>
            Este link é pessoal e vale por 7 dias. Não repasse para outras pessoas.
          </p>
        </footer>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, WalletCards } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { PaginationControls } from '@/components/ui/PaginationControls';
import { NewEntryModal } from '@/components/financial/NewEntryModal';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import api from '@/lib/api';
import { installmentStatusLabel } from '@/lib/financial/financialInstallments';
import { entryStatusLabel } from '@/lib/financial/financialLabels';
import { billingKpiDetailClassName, billingSegmentButton, billingSegmentShellClassName, billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { fetchQuotaAccountEntries, fetchQuotaAccounts } from '@/lib/billing/billingApi';
import { quotaLedgerEntryTypeLabel } from '@/lib/billing/billingOperationalLabels';
import { fmtDate, formatBrlCents } from '@/lib/billing/billingFormat';
import { formatSignedBrlCents, monthInRange, signedAmountClassName, useClientPagination } from '@/lib/billing/billingListUtils';
import { cn } from '@/lib/utils';
import type { ApiEntry } from '@/lib/financial/types';

async function fetchQuotaEntries(driverId?: string): Promise<ApiEntry[]> {
  const res = await api.get('/api/financial/entries', {
    params: { type: 'quota', ...(driverId ? { driver_id: driverId } : {}) },
  });
  return res.data as ApiEntry[];
}

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

type Tab = 'gestao' | 'operacao' | 'vencimentos';

export function BillingQuotasPanel() {
  const [showModal, setShowModal] = useState(false);
  const [search, setSearch] = useState('');
  const [month, setMonth] = useState(defaultMonth());
  const [selectedDriverId, setSelectedDriverId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('gestao');

  const accountsQuery = useQuery({
    queryKey: ['billing', 'quota-accounts'],
    queryFn: () => fetchQuotaAccounts(),
  });
  const entriesQuery = useQuery({
    queryKey: ['billing', 'quotas'],
    queryFn: () => fetchQuotaEntries(),
  });
  const driverQuotaEntriesQuery = useQuery({
    queryKey: ['billing', 'quotas', 'driver', selectedDriverId],
    queryFn: () => fetchQuotaEntries(selectedDriverId || undefined),
    enabled: Boolean(selectedDriverId),
  });
  const historyQuery = useQuery({
    queryKey: ['billing', 'quota-account-entries', selectedDriverId],
    queryFn: () => fetchQuotaAccountEntries(selectedDriverId || ''),
    enabled: Boolean(selectedDriverId),
  });

  const allAccounts = accountsQuery.data || [];

  const globalTotals = useMemo(() => {
    return allAccounts.reduce(
      (acc, account) => {
        acc.integralized += account.integralized_cents || 0;
        acc.balance += account.balance_cents || 0;
        acc.refunded += account.refunded_cents || 0;
        acc.compensated += account.compensated_cents || 0;
        acc.drivers += 1;
        return acc;
      },
      { integralized: 0, balance: 0, refunded: 0, compensated: 0, drivers: 0 }
    );
  }, [allAccounts]);

  const accounts = useMemo(() => {
    const term = search.trim().toLowerCase();
    return allAccounts.filter((account) => {
      if (!term) return true;
      const name = account.drivers?.name?.toLowerCase() || '';
      const cpf = account.drivers?.cpf || '';
      return name.includes(term) || cpf.includes(term);
    });
  }, [allAccounts, search]);

  const accountsPagination = useClientPagination(accounts);
  useEffect(() => {
    accountsPagination.resetPage();
  }, [search, allAccounts.length]);

  const ledgerMovements = useMemo(() => {
    const rows: Array<{
      id: string;
      driverId: string;
      driverName: string;
      date: string;
      type: string;
      description: string;
      amount_cents: number;
    }> = [];
    const history = historyQuery.data || [];
    for (const entry of history) {
      if (!monthInRange(entry.created_at, month)) continue;
      rows.push({
        id: entry.id,
        driverId: selectedDriverId || '',
        driverName: accounts.find((a) => a.driver_id === selectedDriverId)?.drivers?.name || '—',
        date: String(entry.created_at).slice(0, 10),
        type: entry.entry_type,
        description: entry.description || quotaLedgerEntryTypeLabel(entry.entry_type),
        amount_cents: Number(entry.amount_cents || 0),
      });
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [historyQuery.data, month, selectedDriverId, accounts]);

  const ledgerPagination = useClientPagination(ledgerMovements);

  const upcoming = useMemo(() => {
    const items: { driver: string; due: string; amount: number; status: string }[] = [];
    for (const entry of entriesQuery.data || []) {
      const driver = entry.drivers?.name || '—';
      for (const inst of entry.financial_installments || []) {
        if (!monthInRange(inst.due_date, month) && month) continue;
        items.push({
          driver,
          due: inst.due_date,
          amount: Number(inst.amount),
          status: inst.status,
        });
      }
    }
    return items.filter((i) => i.status === 'pending').sort((a, b) => a.due.localeCompare(b.due));
  }, [entriesQuery.data, month]);

  const upcomingPagination = useClientPagination(upcoming);

  const quotaDiscountRows = useMemo(() => {
    const rows: {
      id: string;
      date: string;
      description: string;
      amount: number;
      status: string;
      installment?: string;
    }[] = [];
    for (const entry of driverQuotaEntriesQuery.data || []) {
      const instList = entry.financial_installments || [];
      if (instList.length) {
        for (const inst of instList) {
          if (month && !monthInRange(inst.due_date, month)) continue;
          rows.push({
            id: inst.id,
            date: inst.due_date,
            description: entry.description || 'Desconto de cota cooperativa',
            amount: Number(inst.amount),
            status: inst.status,
            installment: `${inst.installment_number}/${instList.length}`,
          });
        }
      } else {
        const date = String(entry.start_date || entry.event_date || '').slice(0, 10);
        if (month && !monthInRange(date, month)) continue;
        rows.push({
          id: entry.id,
          date,
          description: entry.description || 'Desconto de cota cooperativa',
          amount: Number(entry.total_amount),
          status: entry.status,
        });
      }
    }
    return rows.sort((a, b) => b.date.localeCompare(a.date));
  }, [driverQuotaEntriesQuery.data, month]);

  const discountPagination = useClientPagination(quotaDiscountRows);

  const selectedDriverName = useMemo(() => {
    if (!selectedDriverId) return null;
    return allAccounts.find((a) => a.driver_id === selectedDriverId)?.drivers?.name || null;
  }, [allAccounts, selectedDriverId]);

  return (
    <div className="space-y-4">
      <BillingSection
        title="Gestão de cotas cooperativas"
        desc="Painel consolidado de saldos, movimentações do período e vencimentos."
        icon={WalletCards}
        action={
          <div className="flex flex-wrap items-end gap-2">
            <BillingField label="Competência">
              <FormControl type="month" inputSize="sm" className="mt-1 w-36" value={month} onChange={(e) => setMonth(e.target.value)} />
            </BillingField>
            <FormControl
              type="text"
              inputSize="sm"
              className="h-8 w-56"
              placeholder="Filtrar cooperado, CPF..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Button size="sm" onClick={() => setShowModal(true)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Nova cota
            </Button>
          </div>
        }
      >
        <div className="grid gap-3 md:grid-cols-5">
          <div className={billingKpiDetailClassName}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Cooperados</div>
            <div className="mt-1 text-lg font-semibold">{globalTotals.drivers}</div>
          </div>
          <div className={billingKpiDetailClassName}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Integralizado (geral)</div>
            <div className={cn('mt-1 font-mono text-lg font-semibold', signedAmountClassName(globalTotals.integralized))}>
              {formatBrlCents(globalTotals.integralized)}
            </div>
          </div>
          <div className={billingKpiDetailClassName}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Saldo em aberto</div>
            <div className={cn('mt-1 font-mono text-lg font-semibold', signedAmountClassName(globalTotals.balance))}>
              {formatBrlCents(globalTotals.balance)}
            </div>
          </div>
          <div className={billingKpiDetailClassName}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Compensado (geral)</div>
            <div className={cn('mt-1 font-mono text-lg font-semibold', signedAmountClassName(-globalTotals.compensated))}>
              {formatSignedBrlCents(-globalTotals.compensated)}
            </div>
          </div>
          <div className={billingKpiDetailClassName}>
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Devolvido (geral)</div>
            <div className={cn('mt-1 font-mono text-lg font-semibold', signedAmountClassName(-globalTotals.refunded))}>
              {formatSignedBrlCents(-globalTotals.refunded)}
            </div>
          </div>
        </div>
      </BillingSection>

      <div className={billingSegmentShellClassName}>
        {(
          [
            ['gestao', 'Cooperados'],
            ['operacao', 'Operação do período'],
            ['vencimentos', 'Vencimentos'],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className={billingSegmentButton(tab === key)} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'gestao' ? (
        <BillingSection title="Cooperados" desc="Clique em um cooperado para ver operação e extrato do período.">
          <div className={billingTableShellClassName}>
            <table className="w-full text-sm">
              <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
                <tr>
                  <th className="px-4 py-3">Cooperado</th>
                  <th className="px-4 py-3 text-right">Integralizado</th>
                  <th className="px-4 py-3 text-right">Compensado</th>
                  <th className="px-4 py-3 text-right">Devolvido</th>
                  <th className="px-4 py-3 text-right">Saldo</th>
                </tr>
              </thead>
              <tbody>
                {accountsPagination.pageItems.map((account) => (
                  <tr
                    key={account.id}
                    className={cn(
                      'cursor-pointer border-b border-border/40 last:border-0 hover:bg-muted/30',
                      selectedDriverId === account.driver_id && 'bg-primary/5'
                    )}
                    onClick={() => {
                      setSelectedDriverId(account.driver_id);
                      setTab('operacao');
                    }}
                  >
                    <td className="px-4 py-2.5">
                      <div className="font-medium">{account.drivers?.name || '—'}</div>
                      <div className="font-mono text-[10px] text-muted-foreground">{account.drivers?.cpf || 'CPF não informado'}</div>
                    </td>
                    <td className={cn('px-4 py-2.5 text-right font-mono text-xs', signedAmountClassName(account.integralized_cents || 0))}>
                      {formatBrlCents(account.integralized_cents || 0)}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right font-mono text-xs', signedAmountClassName(-(account.compensated_cents || 0)))}>
                      {formatSignedBrlCents(-(account.compensated_cents || 0))}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right font-mono text-xs', signedAmountClassName(-(account.refunded_cents || 0)))}>
                      {formatSignedBrlCents(-(account.refunded_cents || 0))}
                    </td>
                    <td className={cn('px-4 py-2.5 text-right font-mono text-xs font-semibold', signedAmountClassName(account.balance_cents || 0))}>
                      {formatBrlCents(account.balance_cents || 0)}
                    </td>
                  </tr>
                ))}
                {!accounts.length && (
                  <tr>
                    <td colSpan={5} className="p-4">
                      <BillingEmptyState>Nenhuma conta de cota sincronizada ainda.</BillingEmptyState>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            <PaginationControls
              className="px-3"
              page={accountsPagination.page}
              pageSize={accountsPagination.pageSize}
              totalItems={accountsPagination.totalItems}
              onPageChange={accountsPagination.setPage}
              itemLabel="cooperados"
            />
          </div>
        </BillingSection>
      ) : null}

      {tab === 'operacao' ? (
        <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
          <BillingSection
            title={selectedDriverName ? `Operação — ${selectedDriverName}` : 'Operação do período'}
            desc={selectedDriverName ? `Movimentos e descontos em ${month}.` : 'Selecione um cooperado na aba Cooperados.'}
          >
            {selectedDriverId ? (
              <>
                <div className={billingTableShellClassName + ' mb-4'}>
                  <table className="w-full text-sm">
                    <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
                      <tr>
                        <th className="px-4 py-3">Vencimento</th>
                        <th className="px-4 py-3">Descrição</th>
                        <th className="px-4 py-3 text-right">Parcela</th>
                        <th className="px-4 py-3 text-right">Valor</th>
                        <th className="px-4 py-3">Situação</th>
                      </tr>
                    </thead>
                    <tbody>
                      {discountPagination.pageItems.map((row) => (
                        <tr key={row.id} className="border-b border-border/40 last:border-0">
                          <td className="px-4 py-2.5 font-mono text-xs">{fmtDate(row.date)}</td>
                          <td className="px-4 py-2.5 text-xs">{row.description}</td>
                          <td className="px-4 py-2.5 text-right font-mono text-xs">{row.installment || '—'}</td>
                          <td className={cn('px-4 py-2.5 text-right font-mono text-xs font-semibold', signedAmountClassName(-Math.round(row.amount * 100)))}>
                            {formatSignedBrlCents(-Math.round(row.amount * 100))}
                          </td>
                          <td className="px-4 py-2.5 text-xs">
                            {row.installment ? installmentStatusLabel('quota', row.status) : entryStatusLabel(row.status)}
                          </td>
                        </tr>
                      ))}
                      {!quotaDiscountRows.length && (
                        <tr>
                          <td colSpan={5} className="p-4">
                            <BillingEmptyState>Nenhum desconto de cota no período.</BillingEmptyState>
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                  <PaginationControls
                    className="px-3"
                    page={discountPagination.page}
                    pageSize={discountPagination.pageSize}
                    totalItems={discountPagination.totalItems}
                    onPageChange={discountPagination.setPage}
                    itemLabel="lançamentos"
                  />
                </div>
              </>
            ) : (
              <BillingEmptyState>Selecione um cooperado na aba Cooperados para ver a operação.</BillingEmptyState>
            )}
          </BillingSection>

          <BillingSection title="Extrato da conta" desc="Movimentações integralizadas, compensadas e devolvidas.">
            <div className={billingTableShellClassName}>
              <ul className="divide-y divide-border/40">
                {ledgerPagination.pageItems.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between px-4 py-2.5 text-xs">
                    <div>
                      <div className="font-medium">{entry.description}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {quotaLedgerEntryTypeLabel(entry.type)} · {fmtDate(entry.date)}
                      </div>
                    </div>
                    <span className={cn('font-mono font-semibold', signedAmountClassName(entry.amount_cents))}>
                      {formatSignedBrlCents(entry.amount_cents)}
                    </span>
                  </li>
                ))}
                {!selectedDriverId && (
                  <li className="p-4">
                    <BillingEmptyState>Selecione um cooperado.</BillingEmptyState>
                  </li>
                )}
                {selectedDriverId && !ledgerMovements.length && (
                  <li className="p-4">
                    <BillingEmptyState>Sem movimentações no período {month}.</BillingEmptyState>
                  </li>
                )}
              </ul>
              {ledgerMovements.length > 0 ? (
                <PaginationControls
                  className="px-3"
                  page={ledgerPagination.page}
                  pageSize={ledgerPagination.pageSize}
                  totalItems={ledgerPagination.totalItems}
                  onPageChange={ledgerPagination.setPage}
                  itemLabel="movimentos"
                />
              ) : null}
            </div>
          </BillingSection>
        </div>
      ) : null}

      {tab === 'vencimentos' ? (
        <BillingSection title={`Vencimentos — ${month}`} desc="Parcelas de cota pendentes no período.">
          <div className={billingTableShellClassName}>
            <ul className="divide-y divide-border/40">
              {upcomingPagination.pageItems.map((v, i) => (
                <li key={`${v.driver}-${v.due}-${i}`} className="flex items-center justify-between px-4 py-2 text-xs">
                  <div>
                    <div className="font-medium">{v.driver}</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{fmtDate(v.due)}</div>
                  </div>
                  <span className={cn('font-mono font-semibold', signedAmountClassName(-Math.round(v.amount * 100)))}>
                    {formatSignedBrlCents(-Math.round(v.amount * 100))}
                  </span>
                </li>
              ))}
              {!upcoming.length && (
                <li className="p-4">
                  <BillingEmptyState>Nenhum vencimento pendente no período.</BillingEmptyState>
                </li>
              )}
            </ul>
            <PaginationControls
              className="px-3"
              page={upcomingPagination.page}
              pageSize={upcomingPagination.pageSize}
              totalItems={upcomingPagination.totalItems}
              onPageChange={upcomingPagination.setPage}
              itemLabel="vencimentos"
            />
          </div>
        </BillingSection>
      ) : null}

      {showModal ? (
        <NewEntryModal
          onClose={() => setShowModal(false)}
          onCreated={() => {
            setShowModal(false);
            void entriesQuery.refetch();
            void accountsQuery.refetch();
          }}
        />
      ) : null}
    </div>
  );
}

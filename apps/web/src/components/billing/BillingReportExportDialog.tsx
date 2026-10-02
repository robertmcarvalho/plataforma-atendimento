'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { FormControl } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { BillingDialogContent, BillingField } from '@/components/billing/BillingPrimitives';
import {
  fetchCapitalCooperativoReport,
  fetchProviderAccounts,
  fetchQuotaAccountEntries,
  fetchQuotaAccounts,
  type BillingCapitalCooperativoLine,
} from '@/lib/billing/billingApi';
import {
  capitalCoopMovementTypeLabel,
  capitalCoopSourceLabel,
  quotaLedgerEntryTypeLabel,
} from '@/lib/billing/billingOperationalLabels';
import { fmtDate } from '@/lib/billing/billingFormat';
import { downloadSpreadsheet, monthInRange } from '@/lib/billing/billingListUtils';

export type BillingReportExportKind = 'capital_cooperativo' | 'quota_accounts' | 'internal_providers';

const CAPITAL_TYPE_OPTIONS = [
  { value: '', label: 'Todos os tipos' },
  { value: 'integralization', label: 'Integralização de cota' },
  { value: 'compensation', label: 'Compensação de cota' },
  { value: 'refund', label: 'Devolução de cota' },
  { value: 'adjustment', label: 'Ajuste de cota' },
  { value: 'reversal', label: 'Estorno de cota' },
  { value: 'advance_recovery', label: 'Adiantamento' },
  { value: 'uniform_recovery', label: 'Uniforme' },
  { value: 'bag_recovery', label: 'Bag / mochila' },
  { value: 'digital_cert_recovery', label: 'Certificado digital' },
  { value: 'other_financial_recovery', label: 'Outras recuperações' },
];

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

type Props = {
  kind: BillingReportExportKind | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function BillingReportExportDialog({ kind, open, onOpenChange }: Props) {
  const [month, setMonth] = useState(defaultMonth());
  const [driverSearch, setDriverSearch] = useState('');
  const [entryType, setEntryType] = useState('');
  const [providerSearch, setProviderSearch] = useState('');
  const [exporting, setExporting] = useState(false);

  const capitalQuery = useQuery({
    queryKey: ['billing', 'report-export', 'capital', month],
    queryFn: () => fetchCapitalCooperativoReport(month),
    enabled: open && kind === 'capital_cooperativo' && Boolean(month),
  });

  const quotaAccountsQuery = useQuery({
    queryKey: ['billing', 'report-export', 'quota-accounts'],
    queryFn: () => fetchQuotaAccounts(),
    enabled: open && kind === 'quota_accounts',
  });

  const providerAccountsQuery = useQuery({
    queryKey: ['billing', 'report-export', 'provider-accounts'],
    queryFn: () => fetchProviderAccounts(),
    enabled: open && kind === 'internal_providers',
  });

  const title = useMemo(() => {
    if (kind === 'capital_cooperativo') return 'Exportar — Capital cooperativo';
    if (kind === 'quota_accounts') return 'Exportar — Conta corrente de cotas';
    if (kind === 'internal_providers') return 'Exportar — Conta corrente de prestadores';
    return 'Exportar relatório';
  }, [kind]);

  const description = useMemo(() => {
    if (kind === 'capital_cooperativo') {
      return 'Configure competência e tipo de movimento. O arquivo CSV abre diretamente no Excel.';
    }
    if (kind === 'quota_accounts') {
      return 'Exporta saldos por cooperado e extrato do período selecionado.';
    }
    return 'Exporta saldos e movimentos consolidados dos prestadores internos.';
  }, [kind]);

  const filterCapitalLines = (lines: BillingCapitalCooperativoLine[]) => {
    const term = driverSearch.trim().toLowerCase();
    return lines.filter((line) => {
      if (entryType && line.entry_type !== entryType) return false;
      if (!term) return true;
      const name = line.driver_name?.toLowerCase() || '';
      return name.includes(term) || line.driver_id.toLowerCase().includes(term);
    });
  };

  const handleExport = async () => {
    if (!kind) return;
    setExporting(true);
    try {
      if (kind === 'capital_cooperativo') {
        const report = capitalQuery.data || (await fetchCapitalCooperativoReport(month));
        const lines = filterCapitalLines(report.lines || []);
        downloadSpreadsheet(
          `capital-cooperativo-${month}.csv`,
          ['Data', 'Cooperado', 'Origem', 'Tipo', 'Valor (R$)', 'Descrição', 'Ciclo', 'Acerto', 'Desligamento'],
          lines.map((line) => [
            line.movement_date,
            line.driver_name || line.driver_id,
            capitalCoopSourceLabel(line.source),
            capitalCoopMovementTypeLabel(line.source, line.entry_type),
            (line.amount_cents / 100).toFixed(2).replace('.', ','),
            line.description || '',
            line.billing_cycle_id || '',
            line.settlement_id || '',
            line.offboarding_preview_id || '',
          ])
        );
      }

      if (kind === 'quota_accounts') {
        const accounts = (quotaAccountsQuery.data || []).filter((account) => {
          const term = driverSearch.trim().toLowerCase();
          if (!term) return true;
          const name = account.drivers?.name?.toLowerCase() || '';
          const cpf = account.drivers?.cpf || '';
          return name.includes(term) || cpf.includes(term);
        });

        const movementRows: Array<Array<string | number | null | undefined>> = [];
        for (const account of accounts) {
          const entries = await fetchQuotaAccountEntries(account.driver_id);
          for (const entry of entries) {
            if (!monthInRange(entry.created_at, month)) continue;
            movementRows.push([
              fmtDate(String(entry.created_at).slice(0, 10)),
              account.drivers?.name || account.driver_id,
              account.drivers?.cpf || '',
              quotaLedgerEntryTypeLabel(entry.entry_type),
              (Number(entry.amount_cents || 0) / 100).toFixed(2).replace('.', ','),
              entry.description || '',
            ]);
          }
        }

        downloadSpreadsheet(
          `cotas-saldos-${month}.csv`,
          ['Cooperado', 'CPF', 'Integralizado (R$)', 'Compensado (R$)', 'Devolvido (R$)', 'Saldo (R$)'],
          accounts.map((account) => [
            account.drivers?.name || account.driver_id,
            account.drivers?.cpf || '',
            (Number(account.integralized_cents || 0) / 100).toFixed(2).replace('.', ','),
            (Number(account.compensated_cents || 0) / 100).toFixed(2).replace('.', ','),
            (Number(account.refunded_cents || 0) / 100).toFixed(2).replace('.', ','),
            (Number(account.balance_cents || 0) / 100).toFixed(2).replace('.', ','),
          ])
        );

        if (movementRows.length) {
          downloadSpreadsheet(
            `cotas-movimentos-${month}.csv`,
            ['Data', 'Cooperado', 'CPF', 'Tipo', 'Valor (R$)', 'Descrição'],
            movementRows
          );
        }
      }

      if (kind === 'internal_providers') {
        const accounts = (providerAccountsQuery.data || []).filter((account) => {
          const term = providerSearch.trim().toLowerCase();
          if (!term) return true;
          return (account.billing_internal_providers?.legal_name || '').toLowerCase().includes(term);
        });
        downloadSpreadsheet(
          `prestadores-${month}.csv`,
          ['Prestador', 'Adiantamento aberto (R$)', 'Crédito serviço (R$)', 'Compensado (R$)', 'Saldo (R$)'],
          accounts.map((account) => [
            account.billing_internal_providers?.legal_name || account.provider_id,
            (Number(account.advance_open_cents || 0) / 100).toFixed(2).replace('.', ','),
            (Number(account.service_credit_cents || 0) / 100).toFixed(2).replace('.', ','),
            (Number(account.compensated_cents || 0) / 100).toFixed(2).replace('.', ','),
            (Number(account.balance_cents || 0) / 100).toFixed(2).replace('.', ','),
          ])
        );
      }

      onOpenChange(false);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg border-border bg-surface p-0">
        <BillingDialogContent title={title} description={description}>
          <div className="space-y-4">
            {(kind === 'capital_cooperativo' || kind === 'quota_accounts') && (
              <BillingField label="Competência">
                <FormControl type="month" inputSize="sm" className="mt-1 w-40" value={month} onChange={(e) => setMonth(e.target.value)} />
              </BillingField>
            )}

            {kind === 'capital_cooperativo' ? (
              <>
                <BillingField label="Tipo de movimento">
                  <FormSelect
                    className="mt-1"
                    size="sm"
                    value={entryType}
                    onChange={setEntryType}
                    options={CAPITAL_TYPE_OPTIONS}
                  />
                </BillingField>
                <BillingField label="Filtrar cooperado (opcional)">
                  <FormControl
                    type="text"
                    inputSize="sm"
                    className="mt-1"
                    placeholder="Nome ou ID"
                    value={driverSearch}
                    onChange={(e) => setDriverSearch(e.target.value)}
                  />
                </BillingField>
                {capitalQuery.data ? (
                  <p className="text-xs text-muted-foreground">
                    Prévia: {filterCapitalLines(capitalQuery.data.lines || []).length} movimento(s) em {month}.
                  </p>
                ) : null}
              </>
            ) : null}

            {kind === 'quota_accounts' ? (
              <BillingField label="Filtrar cooperado (opcional)">
                <FormControl
                  type="text"
                  inputSize="sm"
                  className="mt-1"
                  placeholder="Nome ou CPF"
                  value={driverSearch}
                  onChange={(e) => setDriverSearch(e.target.value)}
                />
              </BillingField>
            ) : null}

            {kind === 'internal_providers' ? (
              <BillingField label="Filtrar prestador (opcional)">
                <FormControl
                  type="text"
                  inputSize="sm"
                  className="mt-1"
                  placeholder="Nome do prestador"
                  value={providerSearch}
                  onChange={(e) => setProviderSearch(e.target.value)}
                />
              </BillingField>
            ) : null}

            <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
              <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
                Cancelar
              </Button>
              <Button type="button" size="sm" onClick={() => void handleExport()} disabled={exporting}>
                <Download className="mr-1 h-3.5 w-3.5" />
                {exporting ? 'Gerando…' : 'Salvar Excel (CSV)'}
              </Button>
            </div>
          </div>
        </BillingDialogContent>
      </DialogContent>
    </Dialog>
  );
}

export const BILLING_EXPORT_REPORT_CARDS = [
  {
    id: 'capital_cooperativo' as const,
    title: 'Capital cooperativo',
    description: 'Cotas, compensações, devoluções e recuperações financeiras fora da margem DRE da farmácia.',
    icon: FileSpreadsheet,
    tone: 'bg-channel-instagram/15 text-channel-instagram',
  },
  {
    id: 'quota_accounts' as const,
    title: 'Conta corrente de cotas',
    description: 'Saldos integralizados, compensações e devoluções por cooperado.',
    icon: FileSpreadsheet,
    tone: 'bg-primary/15 text-primary',
  },
  {
    id: 'internal_providers' as const,
    title: 'Conta corrente de prestadores',
    description: 'Adiantamentos, parcelas de compensação e saldo líquido de prestadores internos.',
    icon: FileSpreadsheet,
    tone: 'bg-success/15 text-success',
  },
];

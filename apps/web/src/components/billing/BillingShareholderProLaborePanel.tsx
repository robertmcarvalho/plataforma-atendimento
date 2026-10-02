'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { BillingEmptyState, BillingField, BillingSection } from '@/components/billing/BillingPrimitives';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';
import { downloadShareholderProLaboreInssCsv, fetchShareholderProLaboreInss } from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';

function defaultMonth() {
  const d = new Date();
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}

export function BillingShareholderProLaborePanel() {
  const [month, setMonth] = useState(defaultMonth());
  const reportQuery = useQuery({
    queryKey: ['billing', 'report', 'shareholder-pro-labore', month],
    queryFn: () => fetchShareholderProLaboreInss(month),
    enabled: !!month,
  });

  const download = async () => {
    const csv = await downloadShareholderProLaboreInssCsv(month);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inss-pro-labore-socios-${month}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const rows = reportQuery.data?.rows || [];

  return (
    <div className="space-y-4">
      <BillingSection title="Filtros e exportação" desc="Lista para contabilidade - pró-labore de sócios. O sistema não calcula guias INSS.">
        <div className="flex flex-wrap items-end gap-3">
        <BillingField label="Competência">
          <FormControl type="month" inputSize="sm" className="mt-1 w-36" value={month} onChange={(e) => setMonth(e.target.value)} />
        </BillingField>
        <Button size="sm" variant="outline" onClick={() => void download()} disabled={!rows.length}>
          <Download className="mr-1 h-3.5 w-3.5" /> Exportar CSV
        </Button>
        </div>
      </BillingSection>
      {reportQuery.data ? (
        <p className="text-xs text-muted-foreground">
          Total: <strong>{formatBrlCents(reportQuery.data.total_cents)}</strong> — {rows.length} sócio(s)
        </p>
      ) : null}
      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CPF/CNPJ</th>
              <th className="px-4 py-3">Entidade</th>
              <th className="px-4 py-3 text-right">Pró-labore</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.shareholder_id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5">{r.legal_name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.cpf_cnpj || '—'}</td>
                <td className="px-4 py-2.5 text-xs uppercase">{r.entity_type}</td>
                <td className="px-4 py-2.5 text-right font-mono text-xs">{formatBrlCents(r.pro_labore_cents)}</td>
              </tr>
            ))}
            {!rows.length && !reportQuery.isLoading ? (
              <tr>
                <td colSpan={4} className="p-4">
                  <BillingEmptyState>Nenhum sócio com pró-labore nesta competência.</BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

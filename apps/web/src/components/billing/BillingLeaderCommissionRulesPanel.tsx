'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ReceiptText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { BillingEmptyState, BillingSection } from '@/components/billing/BillingPrimitives';
import { fetchLeaderCommissionItems, saveLeaderCommissionRule } from '@/lib/billing/billingApi';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';

export function BillingLeaderCommissionRulesPanel() {
  const qc = useQueryClient();
  const listQuery = useQuery({ queryKey: ['billing', 'leader-commission-rules'], queryFn: fetchLeaderCommissionItems });
  const [drafts, setDrafts] = useState<Record<string, number>>({});

  const saveMut = useMutation({
    mutationFn: ({ leaderId, pct }: { leaderId: string; pct: number }) =>
      saveLeaderCommissionRule(leaderId, { percent_of_flux_margin: pct, active: pct > 0 }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['billing', 'leader-commission-rules'] }),
  });

  const items = listQuery.data || [];

  return (
    <BillingSection
      title="Comissão de líderes"
      desc="Percentual sobre a margem Flux. Apuração mensal; vencimento AP dia 15."
      icon={ReceiptText}
    >
      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Líder</th>
              <th className="px-4 py-3">Cidade</th>
              <th className="px-4 py-3">% sobre margem Flux</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map(({ leader, rule }) => {
              const pct = drafts[leader.id] ?? Number(rule?.percent_of_flux_margin ?? 0);
              return (
                <tr key={leader.id} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-2.5 font-medium">{leader.name}</td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {[leader.city, leader.state].filter(Boolean).join('/') || '—'}
                  </td>
                  <td className="px-4 py-2.5">
                    <FormControl
                      type="number"
                      inputSize="sm"
                      className="w-24"
                      value={pct}
                      onChange={(e) => setDrafts((d) => ({ ...d, [leader.id]: Number(e.target.value) }))}
                    />
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => saveMut.mutate({ leaderId: leader.id, pct })}
                      disabled={saveMut.isPending}
                    >
                      Salvar
                    </Button>
                  </td>
                </tr>
              );
            })}
            {!items.length && !listQuery.isLoading ? (
              <tr>
                <td colSpan={4} className="p-4">
                  <BillingEmptyState>Nenhum líder no workspace.</BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </BillingSection>
  );
}

'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Percent } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { BillingField, BillingSection, BillingSwitchRow } from '@/components/billing/BillingPrimitives';
import { fetchDreTaxRules, saveDreTaxRule, type BillingDreTaxRule } from '@/lib/billing/billingApi';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';

function entityLabel(entity: string) {
  return entity === 'coop' ? 'CoopMob' : 'Flux Farma';
}

export function BillingDreTaxRulesPanel() {
  const qc = useQueryClient();
  const rulesQuery = useQuery({ queryKey: ['billing', 'dre', 'tax-rules'], queryFn: fetchDreTaxRules });
  const [editing, setEditing] = useState<BillingDreTaxRule | null>(null);

  const saveMut = useMutation({
    mutationFn: () => {
      if (!editing) throw new Error('Nada para salvar');
      return saveDreTaxRule(editing.id, {
        rate_pct: editing.rate_pct,
        name: editing.name,
        active: editing.active,
        effective_from: editing.effective_from,
        effective_until: editing.effective_until,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['billing', 'dre', 'tax-rules'] });
      setEditing(null);
    },
  });

  return (
    <BillingSection
      title="Impostos DRE"
      desc="Alíquotas usadas no DRE gerencial por competência. INSS cooperados usa a base do relatório INSS contabilidade."
      icon={Percent}
    >

      {editing ? (
        <div className="rounded-xl border border-border bg-background/50 p-4">
          <p className="mb-3 text-sm font-medium">
            {entityLabel(editing.entity_type)} — {editing.tax_code}
          </p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <BillingField label="Nome">
              <FormControl className="mt-1" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </BillingField>
            <BillingField label="Alíquota (%)">
              <FormControl
                className="mt-1"
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={editing.rate_pct}
                onChange={(e) => setEditing({ ...editing, rate_pct: Number(e.target.value) })}
              />
            </BillingField>
            <BillingField label="Vigência início">
              <FormControl
                type="date"
                className="mt-1 w-full"
                value={editing.effective_from || ''}
                onChange={(e) => setEditing({ ...editing, effective_from: e.target.value || null })}
              />
            </BillingField>
            <BillingField label="Vigência fim">
              <FormControl
                type="date"
                className="mt-1 w-full"
                value={editing.effective_until || ''}
                onChange={(e) => setEditing({ ...editing, effective_until: e.target.value || null })}
              />
            </BillingField>
          </div>
          <div className="mt-3 flex items-center gap-4">
            <BillingSwitchRow
              checked={editing.active}
              onChange={(checked) => setEditing({ ...editing, active: checked })}
              label="Regra ativa"
            />
            <div className="ml-auto flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => saveMut.mutate()} disabled={saveMut.isPending}>
                Salvar
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Entidade</th>
              <th className="px-4 py-3">Código</th>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Alíquota %</th>
              <th className="px-4 py-3">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(rulesQuery.data || []).map((r) => (
              <tr key={r.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 text-xs">{entityLabel(r.entity_type)}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.tax_code}</td>
                <td className="px-4 py-2.5">{r.name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{r.rate_pct}%</td>
                <td className="px-4 py-2.5 text-xs">{r.active ? 'Ativa' : 'Inativa'}</td>
                <td className="px-4 py-2.5 text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing({ ...r })}>
                    Editar
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </BillingSection>
  );
}

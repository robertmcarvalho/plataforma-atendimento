'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Handshake } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { BillingEmptyState, BillingSection } from '@/components/billing/BillingPrimitives';
import { cn } from '@/lib/utils';
import { fetchCommercialPartners } from '@/lib/billing/billingApi';
import { billingSegmentButton, billingSegmentShellClassName, billingTableShellClassName } from '@/lib/billing/billingReviveUi';

const KIND_LABELS: Record<string, string> = {
  sales_agent: 'Vendas',
  referrer: 'Indicação',
  both: 'Ambos',
};

export function BillingCommercialPartnersPanel() {
  const [kind, setKind] = useState<'all' | 'sales_agent' | 'referrer' | 'both'>('all');
  const listQuery = useQuery({
    queryKey: ['billing', 'commercial-partners', kind],
    queryFn: () =>
      fetchCommercialPartners(false, kind === 'all' ? undefined : kind),
  });

  const rows = useMemo(() => listQuery.data || [], [listQuery.data]);

  return (
    <BillingSection
      title="Parceiros comerciais"
      desc="Parceiros de venda e indicação usados no cálculo de comissões."
      icon={Handshake}
      action={
        <Link href="/billing/cadastro/parceiros/new" className={buttonVariants({ size: 'sm' })}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Novo parceiro
        </Link>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className={billingSegmentShellClassName}>
          {(
            [
              ['all', 'Todos'],
              ['sales_agent', 'Vendas'],
              ['referrer', 'Indicação'],
              ['both', 'Ambos'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setKind(id)}
              className={billingSegmentButton(kind === id)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">CPF/CNPJ</th>
              <th className="px-4 py-3">Tipo</th>
              <th className="px-4 py-3">Entidade</th>
              <th className="px-4 py-3">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{p.legal_name}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{p.cpf_cnpj || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{KIND_LABELS[p.partner_kind] || p.partner_kind}</td>
                <td className="px-4 py-2.5 text-xs uppercase">{p.default_entity}</td>
                <td className="px-4 py-2.5 text-xs">{p.active ? 'Ativo' : 'Inativo'}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/billing/cadastro/parceiros/${p.id}`}
                    className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'px-2')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
            {!rows.length && !listQuery.isLoading ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-muted-foreground">
                  <BillingEmptyState>Nenhum parceiro cadastrado.</BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </BillingSection>
  );
}

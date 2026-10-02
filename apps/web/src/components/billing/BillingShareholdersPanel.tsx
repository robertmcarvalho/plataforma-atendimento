'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Plus, Pencil, Users } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { BillingEmptyState, BillingSection } from '@/components/billing/BillingPrimitives';
import { cn } from '@/lib/utils';
import { fetchShareholders } from '@/lib/billing/billingApi';
import { formatBrlCents } from '@/lib/billing/billingFormat';
import { billingTableShellClassName } from '@/lib/billing/billingReviveUi';

export function BillingShareholdersPanel() {
  const listQuery = useQuery({ queryKey: ['billing', 'shareholders'], queryFn: () => fetchShareholders() });

  return (
    <BillingSection
      title="Sócios"
      desc="Participações, pró-labore e dados de pagamento dos sócios."
      icon={Users}
      action={
        <Link href="/billing/cadastro/socios/new" className={buttonVariants({ size: 'sm' })}>
          <Plus className="mr-1 h-3.5 w-3.5" /> Novo sócio
        </Link>
      }
    >
      <div className={billingTableShellClassName}>
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-[10px] uppercase tracking-wider text-subtle-foreground">
            <tr>
              <th className="px-4 py-3">Nome</th>
              <th className="px-4 py-3">Entidade</th>
              <th className="px-4 py-3">CPF/CNPJ</th>
              <th className="px-4 py-3">%</th>
              <th className="px-4 py-3">Pró-labore</th>
              <th className="px-4 py-3">Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(listQuery.data || []).map((s) => (
              <tr key={s.id} className="border-b border-border/40 last:border-0">
                <td className="px-4 py-2.5 font-medium">{s.legal_name}</td>
                <td className="px-4 py-2.5 text-xs uppercase">{s.entity_type}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{s.cpf_cnpj || '—'}</td>
                <td className="px-4 py-2.5 text-xs">{s.ownership_pct ?? '—'}</td>
                <td className="px-4 py-2.5 font-mono text-xs">{formatBrlCents(s.pro_labore_default_cents)}</td>
                <td className="px-4 py-2.5 text-xs">{s.active ? 'Ativo' : 'Inativo'}</td>
                <td className="px-4 py-2.5 text-right">
                  <Link
                    href={`/billing/cadastro/socios/${s.id}`}
                    className={cn(buttonVariants({ size: 'sm', variant: 'ghost' }), 'px-2')}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Link>
                </td>
              </tr>
            ))}
            {!listQuery.data?.length && !listQuery.isLoading ? (
              <tr>
                <td colSpan={7} className="p-4">
                  <BillingEmptyState>Nenhum sócio cadastrado.</BillingEmptyState>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </BillingSection>
  );
}

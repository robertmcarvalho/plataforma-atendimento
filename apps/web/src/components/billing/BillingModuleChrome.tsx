'use client';

import { Wallet } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { BillingSubNav } from '@/components/billing/BillingSubNav';

/** Cabeçalho + sub-nav únicos do módulo (espelha Financeiro.tsx do Revive). */
export function BillingModuleChrome({ children }: { children: React.ReactNode }) {
  return (
    <>
      <PageHeader
        live
        icon={Wallet}
        eyebrow="Financeiro"
        title="Faturamento"
        description="Acertos, faturamento, contas a pagar/receber, despesas e DRE — tudo em um só lugar."
      />
      <BillingSubNav />
      {children}
    </>
  );
}

'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { BillingCostCenterPanel } from '@/components/billing/BillingCostCenterPanel';
import { BillingLegalEntitiesPanel } from '@/components/billing/BillingLegalEntitiesPanel';
import { BillingExpenseTypesPanel } from '@/components/billing/BillingExpenseTypesPanel';
import { BillingSuppliersPanel } from '@/components/billing/BillingSuppliersPanel';
import { BillingDreTaxRulesPanel } from '@/components/billing/BillingDreTaxRulesPanel';
import { BillingBankAccountsPanel } from '@/components/billing/BillingBankAccountsPanel';
import { BillingLeaderCommissionRulesPanel } from '@/components/billing/BillingLeaderCommissionRulesPanel';
import { BillingNfseConfigPanel } from '@/components/billing/BillingNfseConfigPanel';
import { BillingCoraConfigPanel } from '@/components/billing/BillingCoraConfigPanel';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { billingTabsListClassName, billingTabsTriggerClassName } from '@/lib/billing/billingReviveUi';
import { Banknote, Building2, Landmark, Percent, Receipt, ReceiptText, Tags, Truck } from 'lucide-react';

const TAB_IDS = [
  'entidades',
  'nfse',
  'cora',
  'centros',
  'tipos',
  'fornecedores',
  'contas-bancarias',
  'comissao-lideres',
  'impostos-dre',
] as const;

type TabId = (typeof TAB_IDS)[number];

export default function BillingConfigPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = searchParams.get('tab');
  const tab: TabId = TAB_IDS.includes(q as TabId) ? (q as TabId) : 'entidades';

  const onTab = (v: string) => {
    router.replace(`/billing/config?tab=${v}`, { scroll: false });
  };

  return (
    <>
      <Tabs value={tab} onValueChange={onTab}>
        <TabsList className={billingTabsListClassName}>
          <TabsTrigger value="entidades" className={billingTabsTriggerClassName}>
            <Landmark className="h-3.5 w-3.5" />
            Entidades
          </TabsTrigger>
          <TabsTrigger value="nfse" className={billingTabsTriggerClassName}>
            <Receipt className="h-3.5 w-3.5" />
            NFS-e
          </TabsTrigger>
          <TabsTrigger value="cora" className={billingTabsTriggerClassName}>
            <Banknote className="h-3.5 w-3.5" />
            Cora / Boletos
          </TabsTrigger>
          <TabsTrigger value="centros" className={billingTabsTriggerClassName}>
            <Building2 className="h-3.5 w-3.5" />
            Centros de custo
          </TabsTrigger>
          <TabsTrigger value="tipos" className={billingTabsTriggerClassName}>
            <Tags className="h-3.5 w-3.5" />
            Tipos de despesa
          </TabsTrigger>
          <TabsTrigger value="fornecedores" className={billingTabsTriggerClassName}>
            <Truck className="h-3.5 w-3.5" />
            Fornecedores
          </TabsTrigger>
          <TabsTrigger value="contas-bancarias" className={billingTabsTriggerClassName}>
            <Banknote className="h-3.5 w-3.5" />
            Contas bancárias
          </TabsTrigger>
          <TabsTrigger value="comissao-lideres" className={billingTabsTriggerClassName}>
            <ReceiptText className="h-3.5 w-3.5" />
            Comissão líderes
          </TabsTrigger>
          <TabsTrigger value="impostos-dre" className={billingTabsTriggerClassName}>
            <Percent className="h-3.5 w-3.5" />
            Impostos DRE
          </TabsTrigger>
        </TabsList>

        <TabsContent value="entidades" className="mt-0">
          <BillingLegalEntitiesPanel />
        </TabsContent>
        <TabsContent value="nfse" className="mt-0">
          <BillingNfseConfigPanel />
        </TabsContent>
        <TabsContent value="cora" className="mt-0">
          <BillingCoraConfigPanel />
        </TabsContent>
        <TabsContent value="centros" className="mt-0">
          <BillingCostCenterPanel />
        </TabsContent>
        <TabsContent value="tipos" className="mt-0">
          <BillingExpenseTypesPanel />
        </TabsContent>
        <TabsContent value="fornecedores" className="mt-0">
          <BillingSuppliersPanel />
        </TabsContent>
        <TabsContent value="contas-bancarias" className="mt-0">
          <BillingBankAccountsPanel />
        </TabsContent>
        <TabsContent value="comissao-lideres" className="mt-0">
          <BillingLeaderCommissionRulesPanel />
        </TabsContent>
        <TabsContent value="impostos-dre" className="mt-0">
          <BillingDreTaxRulesPanel />
        </TabsContent>
      </Tabs>

      <div className="mt-4 rounded-md border border-dashed border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
        Split de faturamento (Coop × Flux), taxas, mínimo garantido e regras de vínculo entregador × farmácia são
        configurados diretamente na <strong>ficha de cada farmácia</strong> — fonte única de verdade.
      </div>
    </>
  );
}

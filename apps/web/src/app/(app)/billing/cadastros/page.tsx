'use client';

import { useEffect, useState } from 'react';
import { BillingInternalProvidersPanel } from '@/components/billing/BillingInternalProvidersPanel';
import { BillingShareholdersPanel } from '@/components/billing/BillingShareholdersPanel';
import { BillingCommercialPartnersPanel } from '@/components/billing/BillingCommercialPartnersPanel';
import { billingSubNavClassName } from '@/lib/billing/billingReviveUi';
import { cn } from '@/lib/utils';
import { useRouter, useSearchParams } from 'next/navigation';
import { BriefcaseBusiness, Handshake, Users } from 'lucide-react';

const tabs = [
  { id: 'prestadores', label: 'Prestadores', icon: BriefcaseBusiness },
  { id: 'socios', label: 'Sócios', icon: Users },
  { id: 'parceiros', label: 'Parceiros comerciais', icon: Handshake },
] as const;

type TabId = (typeof tabs)[number]['id'];

export default function BillingCadastrosPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tab, setTab] = useState<TabId>('prestadores');

  useEffect(() => {
    const q = searchParams.get('tab');
    if (q === 'prestadores' || q === 'socios' || q === 'parceiros') {
      setTab(q);
    }
  }, [searchParams]);

  return (
    <>
      <div className={cn(billingSubNavClassName, 'mb-4')}>
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => {
              setTab(t.id);
              router.replace(`/billing/cadastros?tab=${t.id}`, { scroll: false });
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              tab === t.id ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:bg-surface-hover'
            )}
          >
            <t.icon className="h-3.5 w-3.5" />
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'prestadores' && <BillingInternalProvidersPanel />}
      {tab === 'socios' && <BillingShareholdersPanel />}
      {tab === 'parceiros' && <BillingCommercialPartnersPanel />}
    </>
  );
}

'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Banknote,
  ClipboardList,
  Coins,
  FileText,
  LayoutGrid,
  Receipt,
  Settings,
  Truck,
  Users,
  Wallet,
  Landmark,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';
import { billingSubNavClassName } from '@/lib/billing/billingReviveUi';
import { useAuth } from '@/store/auth';
import {
  FINANCIAL_AUDITOR_BILLING_HREFS,
  isFinancialAuditorRole,
} from '@/lib/billing/billingFinancialAuth';

type BillingNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  exact?: boolean;
};

const items: BillingNavItem[] = [
  { href: '/billing', label: 'Visão geral', icon: LayoutGrid, exact: true },
  { href: '/billing/acertos', label: 'Acertos', icon: Receipt },
  { href: '/billing/entregas', label: 'Entregas', icon: Truck },
  { href: '/billing/faturamento', label: 'Faturamento', icon: FileText },
  { href: '/billing/receber', label: 'A receber', icon: ArrowDownToLine },
  { href: '/billing/pagar', label: 'A pagar', icon: ArrowUpFromLine },
  { href: '/billing/despesas', label: 'Despesas', icon: Coins },
  { href: '/billing/cotas', label: 'Cotas', icon: Wallet },
  { href: '/billing/capital-cooperativo', label: 'Capital coop.', icon: Landmark },
  { href: '/billing/conciliacao', label: 'Conciliação', icon: Banknote },
  { href: '/billing/cadastros', label: 'Cadastros', icon: Users },
  { href: '/billing/relatorios', label: 'Relatórios', icon: ClipboardList },
  { href: '/billing/config', label: 'Configurações', icon: Settings },
];

const auditorHrefSet = new Set<string>(FINANCIAL_AUDITOR_BILLING_HREFS);

export function BillingSubNav() {
  const pathname = usePathname();
  const role = useAuth((s) => s.user?.role);
  const visibleItems = isFinancialAuditorRole(role)
    ? items.filter((item) => auditorHrefSet.has(item.href) || item.href === '/billing/dre')
    : items;

  return (
    <div className={billingSubNavClassName}>
      {visibleItems.map((item) => {
        const active = item.exact
          ? pathname === item.href
          : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              'flex shrink-0 items-center gap-1 rounded-md px-2 py-1.5 text-[11px] font-medium transition-colors xl:px-2.5 xl:text-xs',
              active
                ? 'bg-primary text-primary-foreground shadow-sm'
                : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground'
            )}
          >
            <item.icon className="h-3 w-3 xl:h-3.5 xl:w-3.5" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

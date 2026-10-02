'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/store/auth';
import { roleCanAccessBilling, setBillingModuleEnabledCache } from '@/lib/billing/billingAccess';
import { useBillingModuleStatus } from '@/lib/billing/useBillingQueries';
import { CadastroPageScroll } from '@/components/cadastro/CadastroPrimitives';

export function BillingLayoutGate({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const { data, isLoading, isError } = useBillingModuleStatus();

  useEffect(() => {
    if (data?.enabled !== undefined) setBillingModuleEnabledCache(data.enabled);
  }, [data?.enabled]);

  useEffect(() => {
    if (!hasHydrated || isLoading) return;
    if (data?.enabled === false) router.replace('/inbox');
  }, [hasHydrated, isLoading, data?.enabled, router]);

  if (!hasHydrated || isLoading) {
    return (
      <CadastroPageScroll maxWidthClassName="max-w-7xl">
        <div className="animate-pulse space-y-3 py-8">
          <div className="h-8 w-48 rounded bg-muted" />
          <div className="h-32 rounded bg-muted" />
        </div>
      </CadastroPageScroll>
    );
  }

  if (data?.enabled === false) return null;

  if (!roleCanAccessBilling(user?.role, user?.permissions)) {
    return (
      <CadastroPageScroll maxWidthClassName="max-w-7xl">
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Seu perfil não tem acesso ao módulo de faturamento.
        </p>
      </CadastroPageScroll>
    );
  }

  if (isError) {
    return (
      <CadastroPageScroll maxWidthClassName="max-w-7xl">
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Não foi possível carregar o módulo de faturamento. Verifique se a migration 084 foi aplicada no banco dev
          e se `BILLING_MODULE_ENABLED` está ativo.
        </p>
      </CadastroPageScroll>
    );
  }

  return (
    <CadastroPageScroll maxWidthClassName="max-w-7xl">
      {children}
    </CadastroPageScroll>
  );
}

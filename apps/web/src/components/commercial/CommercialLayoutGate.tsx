'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { roleCanAccessCommercial, setCommercialCrmEnabledCache } from '@/lib/commercial/commercialAccess';
import { useCommercialCrmEnabled } from '@/lib/commercial/useCommercialQueries';
import { CommercialForbidden } from '@/components/commercial/CommercialForbidden';
import { CadastroPageScroll } from '@/components/cadastro/CadastroPrimitives';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import { CommercialNotificationsBell } from '@/components/commercial/CommercialNotificationsBell';

export function CommercialLayoutGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const isPipeline = pathname === '/commercial/pipeline';
  const user = useAuth((s) => s.user);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const { data: crmEnabled, isLoading, isError } = useCommercialCrmEnabled();

  useEffect(() => {
    if (crmEnabled !== undefined) setCommercialCrmEnabledCache(crmEnabled);
  }, [crmEnabled]);

  useEffect(() => {
    if (!hasHydrated || isLoading) return;
    if (crmEnabled === false) {
      router.replace('/inbox');
    }
  }, [hasHydrated, isLoading, crmEnabled, router]);

  if (!hasHydrated || isLoading) {
    return (
      <CadastroPageScroll maxWidthClassName="max-w-7xl">
        <CommercialListSkeleton rows={4} />
      </CadastroPageScroll>
    );
  }

  if (crmEnabled === false) {
    return null;
  }

  if (!roleCanAccessCommercial(user?.role)) {
    return <CommercialForbidden role={user?.role} />;
  }

  if (isError) {
    return (
      <CadastroPageScroll maxWidthClassName="max-w-7xl">
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Não foi possível carregar o módulo comercial. Verifique se `commercial_crm_enabled` está ativo nas
          configurações do workspace.
        </p>
      </CadastroPageScroll>
    );
  }

  const shell = (
    <div className="relative flex h-full min-h-0 flex-col">
      <div className="pointer-events-none absolute right-0 top-0 z-20 flex justify-end">
        <div className="pointer-events-auto">
          <CommercialNotificationsBell />
        </div>
      </div>
      {children}
    </div>
  );

  if (isPipeline) {
    return (
      <div className="h-full min-h-0 overflow-hidden">
        <div className={cn('mx-auto flex h-full min-h-0 flex-col overflow-hidden px-4 py-4 sm:px-8 sm:py-6')}>
          {shell}
        </div>
      </div>
    );
  }

  return <CadastroPageScroll maxWidthClassName="max-w-7xl">{shell}</CadastroPageScroll>;
}

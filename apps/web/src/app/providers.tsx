'use client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ThemeAwareFavicon } from '@/components/branding/ThemeAwareFavicon';
import { ThemeBoot } from '@/components/theme/ThemeBoot';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useAuth } from '@/store/auth';

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: 1 } },
  }));

  useEffect(() => {
    void (async () => {
      try {
        await useAuth.persist.rehydrate();
      } finally {
        // Garantia: se persist/rehydrate falhar, não deixamos a shell bloqueada com ecrã em branco.
        useAuth.getState().setHasHydrated(true);
      }
    })();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <ThemeBoot />
        <ThemeAwareFavicon />
        {children}
      </TooltipProvider>
    </QueryClientProvider>
  );
}

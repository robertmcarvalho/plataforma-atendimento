'use client';

import { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { AppShell } from '@/components/shell/AppShell';
import { useAuth } from '@/store/auth';
import { redirectForRoleOnPath } from '@/lib/requireRoleForPath';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const isAuthenticated = useAuth((s) => s.isAuthenticated);
  const hasHydrated = useAuth((s) => s.hasHydrated);
  const user = useAuth((s) => s.user);

  useEffect(() => {
    if (!hasHydrated) return;
    if (!isAuthenticated) {
      router.replace('/login');
      return;
    }
    const role = user?.role || user?.workspace_role || '';
    const redirect = redirectForRoleOnPath(role, pathname || '/inbox', user?.permissions);
    if (redirect && redirect !== pathname) router.replace(redirect);
  }, [hasHydrated, isAuthenticated, pathname, router, user]);

  if (!hasHydrated) return null;
  if (!isAuthenticated) return null;
  return <AppShell>{children}</AppShell>;
}

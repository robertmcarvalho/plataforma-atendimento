'use client';

import { leaderPortalPageApi } from '@/lib/leaderPortal/leaderPortalPageApi';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Search } from 'lucide-react';
import { LeaderPage } from '@/components/leader/LeaderPage';
import { LeaderMasterDetailLayout } from '@/components/leader/LeaderMasterDetailLayout';
import { LeaderDriverDetailPanel } from '@/components/leader/LeaderDriverDetailPanel';
import { PageHeader } from '@/components/ui/PageHeader';
import { useIsLgUp } from '@/hooks/useMediaQuery';
import {
  interactiveRowPrimary,
  interactiveRowSecondary,
  interactiveRowSurface,
} from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';
import { buttonVariants } from '@/components/ui/button';
import { FormControl } from '@/components/form/FormControl';
import { useAuth } from '@/store/auth';

import { DriverDocumentHeaderBadge } from '@/components/cadastro/driver/DriverDocumentStatusBadge';

type Driver = {
  id: string;
  name: string;
  phone?: string | null;
  status?: string | null;
  cnh_expires_at?: string | null;
  has_digital_certificate?: boolean | null;
  digital_certificate_expires_at?: string | null;
  primary_pharmacy?: { trade_name: string } | null;
};

function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((n) => n[0]!.toUpperCase())
      .join('') || '??'
  );
}

export default function LiderEntregadoresPage() {
  const user = useAuth((s) => s.user);
  const isLgUp = useIsLgUp();
  const [q, setQ] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const driversQuery = useQuery<Driver[]>({
    queryKey: ['leader-portal', 'drivers'],
    queryFn: async () => await leaderPortalPageApi.fetchDrivers() as Driver[],
    enabled: user?.role === 'leader',
  });

  const list = useMemo(() => {
    const query = q.trim().toLowerCase();
    const rows = driversQuery.data || [];
    if (!query) return rows;
    return rows.filter((d) => (d.name || '').toLowerCase().includes(query) || (d.primary_pharmacy?.trade_name || '').toLowerCase().includes(query));
  }, [driversQuery.data, q]);

  const selected = useMemo(() => {
    const rows = driversQuery.data || [];
    const id = selectedId ?? (isLgUp ? rows[0]?.id : null) ?? null;
    return rows.find((d) => d.id === id) || null;
  }, [driversQuery.data, selectedId, isLgUp]);

  const activeDriverId = selected?.id ?? null;

  if (user && user.role !== 'leader') {
    return (
      <div className="mx-auto max-w-3xl px-8 py-10">
        <PageHeader eyebrow="Acesso" title="Meus entregadores" description="Esta área é exclusiva para perfis de líder." compact />
        <Link className={buttonVariants({ variant: 'secondary' })} href="/dashboard">
          Voltar
        </Link>
      </div>
    );
  }

  const listPanel = (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="border-b border-border p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <FormControl
            inputSize="sm"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar entregador..."
            className="pl-8"
          />
        </div>
      </div>
      <ul className="divide-y divide-border">
        {driversQuery.isLoading ? (
          <li className="p-4 text-sm text-muted-foreground">Carregando…</li>
        ) : list.length === 0 ? (
          <li className="p-4 text-sm text-muted-foreground">Nenhum entregador encontrado.</li>
        ) : (
          list.map((d) => {
            const active = activeDriverId === d.id;
            const ok = (d.status || 'active') === 'active';
            return (
              <li key={d.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(d.id)}
                  className={cn('flex w-full items-center gap-3 p-3 text-left', interactiveRowSurface(active))}
                >
                  <div className="relative">
                    <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-channel-instagram text-xs font-semibold text-primary-foreground">
                      {initials(d.name)}
                    </div>
                    <span
                      className={cn(
                        'absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card',
                        ok ? 'bg-success' : 'bg-muted-foreground'
                      )}
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <div className={cn('truncate text-xs font-medium', interactiveRowPrimary(active))}>{d.name}</div>
                      <DriverDocumentHeaderBadge
                        cnhExpiresAt={d.cnh_expires_at}
                        hasDigitalCertificate={d.has_digital_certificate}
                        digitalCertificateExpiresAt={d.digital_certificate_expires_at}
                        className="shrink-0"
                      />
                    </div>
                    <div className={cn('truncate text-[10px]', interactiveRowSecondary(active))}>{d.primary_pharmacy?.trade_name || 'Sem farmácia primária'}</div>
                  </div>
                  <ChevronRight className={cn('h-3.5 w-3.5 shrink-0', interactiveRowSecondary(active))} />
                </button>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );

  const detailPanel = (
    <div className="min-h-0 rounded-xl border border-border bg-card">
      <LeaderDriverDetailPanel driverId={activeDriverId} />
    </div>
  );

  return (
    <LeaderPage fullHeight className="flex min-h-0 flex-1 flex-col">
      <PageHeader eyebrow="Cadastros" title="Meus entregadores" description="Equipe vinculada à sua liderança." />

      <LeaderMasterDetailLayout
        className="min-h-0 flex-1"
        list={listPanel}
        detail={detailPanel}
        hasSelection={Boolean(selectedId)}
        onBack={() => setSelectedId(null)}
        detailTitle={selected?.name}
      />
    </LeaderPage>
  );
}

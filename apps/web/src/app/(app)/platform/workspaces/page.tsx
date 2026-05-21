'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Building2, Plus } from 'lucide-react';
import api from '@/lib/api';
import { PageHeader } from '@/components/ui/PageHeader';
import { useAuth } from '@/store/auth';

type WorkspaceRow = {
  id: string;
  slug: string;
  display_name: string;
  timezone: string;
  is_active: boolean;
};

export default function PlatformWorkspacesPage() {
  const user = useAuth((s) => s.user);
  const switchWorkspace = useAuth((s) => s.switchWorkspace);
  const isPlatform =
    user?.platform_role === 'platform_admin' || user?.platform_role === 'platform_owner';

  const [slug, setSlug] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [message, setMessage] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['platform-workspaces'],
    enabled: isPlatform,
    queryFn: async () => (await api.get('/api/platform/workspaces')).data as WorkspaceRow[],
  });

  if (!isPlatform) {
    return (
      <div className="p-6">
        <PageHeader title="Console da plataforma" description="Acesso restrito ao administrador global." compact />
      </div>
    );
  }

  const createWorkspace = async () => {
    setMessage(null);
    try {
      await api.post('/api/platform/workspaces', {
        slug: slug.trim(),
        display_name: displayName.trim(),
      });
      setSlug('');
      setDisplayName('');
      setMessage('Workspace criado.');
      await query.refetch();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Falha ao criar workspace');
    }
  };

  return (
    <div className="flex h-full flex-col overflow-hidden p-6">
      <PageHeader
        eyebrow="Plataforma SaaS"
        title="Clientes (workspaces)"
        description="Administração global de tenants, onboarding e troca de contexto."
      />

      <div className="mt-6 grid gap-4 lg:grid-cols-[360px_1fr]">
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-sm font-semibold">Novo workspace</h3>
          <label className="mt-3 block text-xs text-muted-foreground">Slug</label>
          <input value={slug} onChange={(e) => setSlug(e.target.value)} className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
          <label className="mt-3 block text-xs text-muted-foreground">Nome exibido</label>
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void createWorkspace()}
            className="mt-4 inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
            Criar workspace
          </button>
          {message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
        </div>

        <div className="rounded-xl border border-border bg-card">
          <div className="border-b border-border px-4 py-3 text-sm font-semibold">Workspaces</div>
          <ul className="divide-y divide-border">
            {(query.data || []).map((ws) => (
              <li key={ws.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{ws.display_name}</p>
                  <p className="text-xs text-muted-foreground">{ws.slug} · {ws.timezone}</p>
                </div>
                <button
                  type="button"
                  onClick={() => void switchWorkspace(ws.id).then(() => window.location.assign('/dashboard'))}
                  className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  Entrar
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

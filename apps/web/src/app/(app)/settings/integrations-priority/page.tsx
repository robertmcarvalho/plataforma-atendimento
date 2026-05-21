'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import api from '@/lib/api';

type Row = {
  id: string;
  name: string;
  domain: 'erp' | 'crm' | 'finance';
  delivery_model: string;
  demand_score: number;
  implementation_effort: number;
  strategic_value: number;
  priority_score: number;
  notes: string;
};

export default function IntegrationsPriorityPage() {
  const query = useQuery({
    queryKey: ['settings', 'integrations', 'priority'],
    queryFn: async () =>
      (await api.get('/api/integrations/connectors/priority')).data as {
        version: string;
        method: string;
        items: Row[];
      },
  });

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl px-8 py-8">
        <Link href="/settings" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" /> Configurações
        </Link>

        <PageHeader
          eyebrow="Configurações"
          title="Priorização de Conectores"
          description="Ranking prático para Sprint 6: ERP/CRM/Financeiro."
        />

        {query.isError ? <div className="mb-3 text-xs text-destructive">Falha ao carregar priorização.</div> : null}
        {query.isLoading ? <div className="mb-3 text-xs text-muted-foreground">Carregando conectores...</div> : null}

        <div className="panel mb-3 rounded-xl p-3 text-xs text-muted-foreground">
          Método: {query.data?.method || '—'}
        </div>

        <div className="overflow-x-auto rounded-xl border border-border/60 bg-background/30">
          <table className="workspace-table min-w-[860px]">
            <thead>
              <tr>
                <th>Conector</th>
                <th>Domínio</th>
                <th>Modelo</th>
                <th>Demanda</th>
                <th>Esforço</th>
                <th>Estratégico</th>
                <th>Score</th>
              </tr>
            </thead>
            <tbody>
              {(query.data?.items || []).map((item) => (
                <tr key={item.id} className="workspace-row">
                  <td className="workspace-cell">
                    <div className="text-xs font-medium">{item.name}</div>
                    <div className="text-[10px] text-subtle-foreground">{item.notes}</div>
                  </td>
                  <td className="workspace-cell text-xs text-muted-foreground">{item.domain.toUpperCase()}</td>
                  <td className="workspace-cell text-xs text-muted-foreground">{item.delivery_model}</td>
                  <td className="workspace-cell text-xs text-muted-foreground">{item.demand_score}</td>
                  <td className="workspace-cell text-xs text-muted-foreground">{item.implementation_effort}</td>
                  <td className="workspace-cell text-xs text-muted-foreground">{item.strategic_value}</td>
                  <td className="workspace-cell">
                    <span className="status-chip border-primary/25 bg-primary/10 text-primary">{item.priority_score}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

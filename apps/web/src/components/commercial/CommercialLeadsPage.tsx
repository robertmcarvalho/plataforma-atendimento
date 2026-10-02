'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Briefcase, Plus } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { CommercialEmptyState } from '@/components/commercial/CommercialEmptyState';
import { CommercialLeadSidebarPanel } from '@/components/commercial/CommercialLeadSidebarPanel';
import { ownerName } from '@/lib/commercial/commercialOwners';
import { filterCommercialLeads } from '@/lib/commercial/commercialFilters';
import { commercialSourceLabel, commercialLeadDisplayName, maskCnpj } from '@/lib/commercial/commercialFormat';
import type { CommercialLeadSource } from '@/lib/commercial/types';
import {
  useCommercialOwners,
  useLeads,
  usePipelineStages,
} from '@/lib/commercial/useCommercialQueries';
import { commercialRevivePrimaryButtonClassName } from '@/components/commercial/CommercialRevivePrimitives';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { cn } from '@/lib/utils';
import { interactiveRowSurface } from '@/lib/interactiveRow';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import { CadastroImportTrigger } from '@/components/cadastros/CadastroImportModal';
import { useQueryClient } from '@tanstack/react-query';
import { commercialKeys } from '@/lib/commercial/commercialKeys';
import { useIsLgUp } from '@/hooks/useMediaQuery';

export function CommercialLeadsPage() {
  const router = useRouter();
  const isLgUp = useIsLgUp();
  const searchParams = useSearchParams();
  const selectedId = searchParams.get('id');
  const qc = useQueryClient();

  const { data: stages = [] } = usePipelineStages();
  const { data: leadsRes, isLoading } = useLeads({ limit: 500 });
  const { data: owners = [] } = useCommercialOwners();
  const leads = useMemo(() => leadsRes?.data ?? [], [leadsRes?.data]);

  const [search, setSearch] = useState('');
  const [stageFilter, setStageFilter] = useState('all');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | CommercialLeadSource>('all');

  const filtered = useMemo(
    () =>
      filterCommercialLeads(leads, {
        stageId: stageFilter,
        ownerId: ownerFilter,
        source: sourceFilter,
        search,
      }).sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()),
    [leads, search, stageFilter, ownerFilter, sourceFilter],
  );

  const selectedLead = selectedId ? leads.find((l) => l.id === selectedId) : filtered[0];

  if (isLoading) {
    return (
      <div>
        <PageHeader icon={Briefcase} eyebrow="Comercial" title="Leads" description="Carregando..." />
        <CommercialListSkeleton rows={8} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        icon={Briefcase}
        eyebrow="Comercial"
        title="Leads"
        description="Busca rápida e ficha lateral do prospect."
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <CadastroImportTrigger
              canImport
              templatePath="/api/commercial/leads/import/template"
              importPath="/api/commercial/leads/import"
              entityLabel="leads comerciais"
              downloadFilename="modelo_importacao_leads.xlsx"
              onImported={() => qc.invalidateQueries({ queryKey: commercialKeys.leads() })}
            />
            <Link href="/commercial/leads/new" className={commercialRevivePrimaryButtonClassName}>
              <Plus className="h-3.5 w-3.5" />
              Novo lead
            </Link>
          </div>
        }
      />

      {leads.length === 0 ? (
        <CommercialEmptyState
          icon={Briefcase}
          title="Nenhum lead cadastrado"
          description="Comece pelo cadastro comercial enxuto — CNPJ e telefone obrigatórios."
          actionLabel="Cadastrar primeiro lead"
          actionHref="/commercial/leads/new"
        />
      ) : (
        <div className="grid min-h-0 flex-1 grid-cols-12 gap-4 overflow-hidden pb-2">
          <section className="col-span-12 flex min-h-0 flex-col overflow-hidden lg:col-span-7">
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-surface">
            <ListToolbar
              className="mb-0 border-b border-border p-3"
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Buscar..."
            >
              <ToolbarSelect
                value={stageFilter}
                onChange={setStageFilter}
                aria-label="Filtrar por estágio"
                options={[
                  { value: 'all', label: 'Todos estágios' },
                  ...stages.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
              <ToolbarSelect
                value={ownerFilter}
                onChange={setOwnerFilter}
                aria-label="Filtrar por owner"
                options={[
                  { value: 'all', label: 'Todos owners' },
                  ...owners.map((o) => ({ value: o.id, label: o.name })),
                ]}
              />
              <ToolbarSelect
                value={sourceFilter}
                onChange={(v) => setSourceFilter(v as typeof sourceFilter)}
                aria-label="Filtrar por origem"
                options={[
                  { value: 'all', label: 'Todas origens' },
                  ...(['manual', 'instagram', 'indicacao', 'whatsapp', 'campanha'] as CommercialLeadSource[]).map((s) => ({
                    value: s,
                    label: commercialSourceLabel(s),
                  })),
                ]}
              />
            </ListToolbar>
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="p-8 text-center text-xs text-muted-foreground">Nenhum lead encontrado.</li>
              ) : null}
              {filtered.map((lead) => {
                const stage = stages.find((s) => s.id === lead.stage_id);
                const active = selectedLead?.id === lead.id;
                const displayName = commercialLeadDisplayName(lead);
                const initials = displayName.slice(0, 2).toUpperCase();
                return (
                  <li key={lead.id}>
                    <button
                      type="button"
                      onClick={() =>
                        router.push(isLgUp ? `/commercial/leads?id=${lead.id}` : `/commercial/leads/${lead.id}`)
                      }
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors',
                        interactiveRowSurface(active),
                      )}
                    >
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/40 to-channel-instagram/40 text-xs font-semibold">
                        {initials}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{displayName}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {[lead.city, lead.state].filter(Boolean).join('/') || '—'} · {lead.contact_name || maskCnpj(lead.cnpj)}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1 lg:hidden">
                        {stage ? (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: `${stage.color}22`, color: stage.color }}
                          >
                            {stage.name}
                          </span>
                        ) : null}
                        <span className="font-mono text-[10px] text-subtle-foreground">
                          {ownerName(lead.owner_id, owners).split(' ')[0]}
                        </span>
                      </div>
                      <div className="hidden flex-col items-end gap-1 lg:flex">
                        {stage ? (
                          <span
                            className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                            style={{ backgroundColor: `${stage.color}22`, color: stage.color }}
                          >
                            {stage.name}
                          </span>
                        ) : null}
                        <span className="font-mono text-[10px] text-subtle-foreground">
                          {ownerName(lead.owner_id, owners).split(' ')[0]}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
            </div>
          </section>

          <section className="hidden min-h-0 flex-col overflow-hidden lg:col-span-5 lg:flex">
            <div className="flex h-full flex-col overflow-y-auto rounded-xl border border-border bg-surface p-5">
              {selectedLead ? (
                <CommercialLeadSidebarPanel leadId={selectedLead.id} />
              ) : (
                <div className="flex h-full items-center justify-center rounded-xl border border-dashed border-border text-xs text-muted-foreground">
                  Selecione um lead
                </div>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

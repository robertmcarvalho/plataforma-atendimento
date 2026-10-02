'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Briefcase, Kanban, Plus, Search, Settings } from 'lucide-react';
import { CadastroBackLink } from '@/components/cadastro/CadastroPrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import {
  commercialReviveOutlineButtonClassName,
  commercialRevivePrimaryButtonClassName,
} from '@/components/commercial/CommercialRevivePrimitives';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { CommercialEmptyState } from '@/components/commercial/CommercialEmptyState';
import { CommercialLeadCard } from '@/components/commercial/CommercialLeadCard';
import { CommercialLossModal } from '@/components/commercial/CommercialLossModal';
import { CommercialStagnantBanner } from '@/components/commercial/CommercialStagnantBanner';
import { COMMERCIAL_TAGS } from '@/lib/commercial/commercialTags';
import { filterCommercialLeads } from '@/lib/commercial/commercialFilters';
import { commercialSourceLabel, leadTemperatureLabel } from '@/lib/commercial/commercialFormat';
import type { CommercialLeadSource, LeadTemperature } from '@/lib/commercial/types';
import {
  useCommercialOwners,
  useLeads,
  useLossReasons,
  useLoseLead,
  useMoveLeadStage,
  usePipelineStages,
} from '@/lib/commercial/useCommercialQueries';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';

export function CommercialPipelinePage() {
  const { data: stages = [], isLoading: stagesLoading } = usePipelineStages();
  const { data: leadsRes, isLoading: leadsLoading } = useLeads({ limit: 500 }, { pollScoring: true });
  const { data: owners = [] } = useCommercialOwners();
  const { data: lossReasons = [] } = useLossReasons();
  const moveStage = useMoveLeadStage();
  const loseLead = useLoseLead();

  const leads = useMemo(() => leadsRes?.data ?? [], [leadsRes?.data]);

  const [search, setSearch] = useState('');
  const [ownerFilter, setOwnerFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | CommercialLeadSource>('all');
  const [tagFilter, setTagFilter] = useState('all');
  const [temperatureFilter, setTemperatureFilter] = useState<'all' | LeadTemperature>('all');
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [lossLeadId, setLossLeadId] = useState<string | null>(null);

  const sortedStages = useMemo(() => [...stages].sort((a, b) => a.sort_order - b.sort_order), [stages]);

  const filteredLeads = useMemo(
    () =>
      filterCommercialLeads(leads, {
        ownerId: ownerFilter,
        source: sourceFilter,
        search,
        tag: tagFilter,
        temperature: temperatureFilter,
      }, sortedStages),
    [leads, search, ownerFilter, sourceFilter, tagFilter, temperatureFilter, sortedStages],
  );

  const handleDrop = async (leadId: string, stageId: string) => {
    const target = stages.find((s) => s.id === stageId);
    if (!target) return;
    if (target.is_won) {
      setMoveError('Use "Marcar como ganho" na ficha do lead para converter em farmácia.');
      return;
    }
    if (target.is_lost) {
      setLossLeadId(leadId);
      return;
    }
    setMoveError(null);
    try {
      await moveStage.mutateAsync({ id: leadId, stage_id: stageId });
    } catch (e) {
      setMoveError(apiErrorMessage(e));
    }
  };

  if (stagesLoading || leadsLoading) {
    return (
      <div>
        <PageHeader icon={Briefcase} eyebrow="Comercial" title="Pipeline" description="Carregando funil..." />
        <CommercialListSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="shrink-0 space-y-3">
        <CadastroBackLink href="/commercial">Voltar para comercial</CadastroBackLink>
        <PageHeader
          icon={Briefcase}
          eyebrow="Comercial"
          title="Pipeline"
          description="Negócios em andamento. Arraste para mudar de estágio."
          actions={
            <>
              <Link href="/commercial/settings" className={commercialReviveOutlineButtonClassName}>
                <Settings className="h-3.5 w-3.5" />
                Configurar
              </Link>
              <Link href="/commercial/leads/new" className={commercialRevivePrimaryButtonClassName}>
                <Plus className="h-3.5 w-3.5" />
                Novo lead
              </Link>
            </>
          }
        />

        {moveError ? <p className="text-sm text-destructive">{moveError}</p> : null}

        <CommercialStagnantBanner leads={leads} stages={stages} />

        <ListToolbar
          searchValue={search}
          onSearchChange={setSearch}
          searchPlaceholder="Buscar lead..."
        >
          <ToolbarSelect
            value={ownerFilter}
            onChange={setOwnerFilter}
            aria-label="Filtrar por vendedor"
            options={[
              { value: 'all', label: 'Todos vendedores' },
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
          <ToolbarSelect
            value={temperatureFilter}
            onChange={(v) => setTemperatureFilter(v as typeof temperatureFilter)}
            aria-label="Filtrar por temperatura"
            options={[
              { value: 'all', label: 'Todas temperaturas' },
              ...(['urgente', 'quente', 'morno', 'frio'] as LeadTemperature[]).map((t) => ({
                value: t,
                label: leadTemperatureLabel(t),
              })),
            ]}
          />
          <ToolbarSelect
            value={tagFilter}
            onChange={setTagFilter}
            aria-label="Filtrar por tag"
            options={[
              { value: 'all', label: 'Todas tags' },
              ...COMMERCIAL_TAGS.map((t) => ({ value: t, label: t })),
            ]}
          />
        </ListToolbar>
      </div>

      {leads.length === 0 ? (
        <CommercialEmptyState
          icon={Kanban}
          title="Pipeline vazio"
          description="Cadastre leads para visualizar o funil comercial."
          actionLabel="Cadastrar primeiro lead"
          actionHref="/commercial/leads/new"
        />
      ) : filteredLeads.length === 0 ? (
        <CommercialEmptyState
          icon={Search}
          title="Nenhum lead com esses filtros"
          description="Limpe a busca ou altere vendedor/origem para ver cards no kanban."
        />
      ) : null}

      {leads.length > 0 && filteredLeads.length > 0 ? (
        <div className="mt-3 min-h-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="flex h-full min-h-0 min-w-max gap-3 pb-2">
            {sortedStages.map((stage) => {
              const columnLeads = filteredLeads.filter((l) => l.stage_id === stage.id);
              return (
                <div
                  key={stage.id}
                  className="flex h-full max-h-full min-h-0 w-72 shrink-0 flex-col overflow-hidden rounded-xl border border-border bg-surface"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const leadId = e.dataTransfer.getData('text/plain');
                    if (leadId) void handleDrop(leadId, stage.id);
                    setDraggingId(null);
                  }}
                >
                  <div className="flex shrink-0 items-center justify-between border-b border-border px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />
                      <span className="text-xs font-semibold">{stage.name}</span>
                      <span className="font-mono text-[10px] text-muted-foreground">({columnLeads.length})</span>
                    </div>
                    <span className="font-mono text-[10px] text-subtle-foreground">{stage.probability}%</span>
                  </div>
                  <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain p-2">
                    <div className="flex flex-col gap-2">
                      {columnLeads.map((lead) => (
                        <CommercialLeadCard
                          key={lead.id}
                          lead={lead}
                          owners={owners}
                          stage={stage}
                          allStages={stages}
                          draggable
                          onDragStart={() => setDraggingId(lead.id)}
                          onDragEnd={() => setDraggingId(null)}
                        />
                      ))}
                      {columnLeads.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border/60 p-4 text-center text-[11px] text-subtle-foreground">
                          Sem leads
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {draggingId ? (
        <p className="mt-2 shrink-0 text-xs text-muted-foreground">
          Arrastando lead — solte em outra coluna para mudar o estágio.
        </p>
      ) : null}

      {lossLeadId ? (
        <CommercialLossModal
          open
          reasons={lossReasons}
          onClose={() => setLossLeadId(null)}
          onConfirm={(reasonId, notes) => {
            void loseLead.mutateAsync({ id: lossLeadId, loss_reason_id: reasonId, notes }).finally(() => {
              setLossLeadId(null);
            });
          }}
        />
      ) : null}
    </div>
  );
}

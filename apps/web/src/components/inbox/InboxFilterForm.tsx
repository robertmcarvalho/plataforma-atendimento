'use client';

import { useMemo } from 'react';
import { FormControl } from '@/components/form/FormControl';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { StatusDot } from '@/components/ui/StatusDot';
import { cn } from '@/lib/utils';
import {
  inboxPriorityFilterLabel,
  inboxStatusFilterLabel,
} from '@/lib/inbox/inboxListFilters';
import type { InboxFolderColumnProps } from '@/components/inbox/InboxFolderColumn';

/** Formulário de filtros da inbox (desktop popover + mobile FilterSheet). */
export function InboxFilterForm({
  search,
  onSearchChange,
  statusFilter,
  onStatusFilterChange,
  priorityFilter,
  onPriorityFilterChange,
  isSupervisor,
  canFilterByAttendant,
  supervisorAttendantId,
  onSupervisorAttendantIdChange,
  supervisorAttendants,
  teamPresence,
  supervisorAttendanceGroup,
  onSupervisorAttendanceGroupChange,
  supervisorSlaStage,
  onSupervisorSlaStageChange,
  supervisorSlaBucket,
  onSupervisorSlaBucketChange,
  sectorFilterId,
  onSectorFilterIdChange,
  sectors,
}: InboxFolderColumnProps) {
  const presenceByUserId = useMemo(() => {
    const map = new Map<string, 'online' | 'idle' | 'offline'>();
    for (const m of teamPresence?.members || []) map.set(m.user_id, m.presence);
    return map;
  }, [teamPresence?.members]);

  const presenceLabel = (userId: string) => {
    const p = presenceByUserId.get(userId);
    if (p === 'online') return 'online';
    if (p === 'idle') return 'ausente';
    return 'offline';
  };

  return (
    <div className="space-y-2">
      <FormControl
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder="Buscar por nome, número ou mensagem"
        inputSize="sm"
        className="text-xs placeholder:text-muted-foreground"
      />

      <div className="grid grid-cols-2 gap-2">
        <ToolbarSelect
          value={statusFilter}
          onChange={(v) => onStatusFilterChange(v as typeof statusFilter)}
          disabled={isSupervisor && supervisorAttendanceGroup !== 'all'}
          className="inbox-t-control"
          fullWidth
          options={[
            { value: 'all', label: 'Status' },
            { value: 'open', label: 'Abertas' },
            { value: 'pending', label: 'Pendentes' },
            { value: 'resolved', label: 'Resolvidas' },
          ]}
        />

        <ToolbarSelect
          value={priorityFilter}
          onChange={(v) => onPriorityFilterChange(v as typeof priorityFilter)}
          className="inbox-t-control"
          fullWidth
          options={[
            { value: 'all', label: 'Prioridade' },
            { value: 'low', label: 'Baixa' },
            { value: 'normal', label: 'Normal' },
            { value: 'high', label: 'Alta' },
            { value: 'urgent', label: 'Urgente' },
          ]}
        />
      </div>

      <ToolbarSelect
        value={sectorFilterId}
        onChange={onSectorFilterIdChange}
        className="inbox-t-control"
        fullWidth
        wideMenu
        options={[
          { value: '', label: 'Setor · todos' },
          ...sectors.map((s) => ({ value: s.id, label: s.name })),
        ]}
      />

      {canFilterByAttendant ? (
        <div className="space-y-2 rounded-md border border-primary/20 bg-primary/5 p-2">
          <div className="flex items-center justify-between gap-2">
            <div className="inbox-t-meta font-semibold uppercase tracking-wide text-primary">
              {isSupervisor ? 'Supervisão do setor' : 'Filtro por atendente'}
            </div>
            {teamPresence ? (
              <span className="inbox-t-meta text-muted-foreground">
                {teamPresence.online_count} online
                {teamPresence.idle_count > 0 ? ` · ${teamPresence.idle_count} ausente` : ''}
              </span>
            ) : null}
          </div>
          <ToolbarSelect
            value={supervisorAttendantId}
            onChange={onSupervisorAttendantIdChange}
            className="inbox-t-control"
            fullWidth
            wideMenu
            options={[
              {
                value: '',
                label: `Todos os atendentes${teamPresence ? ` (${teamPresence.online_count} online)` : ''}`,
              },
              ...supervisorAttendants.map((a) => ({
                value: a.id,
                label: `${a.name} · ${presenceLabel(a.id)}`,
              })),
            ]}
          />
          <div className="max-h-28 space-y-1 overflow-y-auto">
            {supervisorAttendants.slice(0, 8).map((a) => {
              const p = presenceByUserId.get(a.id) || 'offline';
              const selected = supervisorAttendantId === a.id;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onSupervisorAttendantIdChange(a.id)}
                  className={cn(
                    'flex w-full max-lg:min-h-11 items-center gap-2 rounded px-1 py-0.5 text-left text-[10px] transition-colors',
                    selected
                      ? 'bg-primary/15 font-medium text-primary'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                  aria-pressed={selected}
                >
                  <StatusDot presence={p} />
                  <span className="truncate">{a.name}</span>
                </button>
              );
            })}
          </div>
          {isSupervisor ? (
            <>
              <ToolbarSelect
                value={supervisorAttendanceGroup}
                onChange={(v) => onSupervisorAttendanceGroupChange(v as typeof supervisorAttendanceGroup)}
                className="inbox-t-control"
                fullWidth
                wideMenu
                options={[
                  { value: 'all', label: 'Atendimentos · todos os status' },
                  { value: 'active', label: 'Atendimentos · em andamento' },
                  { value: 'waiting', label: 'Atendimentos · aguardando cliente' },
                  { value: 'finished', label: 'Atendimentos · finalizados' },
                ]}
              />
              <div className="grid grid-cols-2 gap-2">
                <ToolbarSelect
                  value={supervisorSlaStage}
                  onChange={(v) => onSupervisorSlaStageChange(v as typeof supervisorSlaStage)}
                  className="inbox-t-control"
                  fullWidth
                  wideMenu
                  options={[
                    { value: '', label: 'SLA · etapa (todas)' },
                    { value: 'first_response', label: '1ª resposta' },
                    { value: 'treatment', label: 'Tratamento' },
                    { value: 'resolution', label: 'Resolução' },
                  ]}
                />
                <ToolbarSelect
                  value={supervisorSlaBucket}
                  onChange={(v) => onSupervisorSlaBucketChange(v as typeof supervisorSlaBucket)}
                  disabled={!supervisorSlaStage}
                  className="inbox-t-control"
                  fullWidth
                  options={[
                    { value: '', label: 'Situação' },
                    { value: 'breached', label: 'Em atraso' },
                    { value: 'at_risk', label: 'Risco (< 10 min)' },
                    { value: 'on_track', label: 'Dentro do prazo' },
                  ]}
                />
              </div>
              <p className="inbox-t-meta leading-snug text-muted-foreground">
                Use as abas “Pendências” e “Tickets” para listas consolidadas do setor com o mesmo atendente filtrado.
              </p>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function inboxFilterChipLabels(props: Pick<
  InboxFolderColumnProps,
  | 'statusFilter'
  | 'priorityFilter'
  | 'search'
  | 'supervisorAttendantId'
  | 'supervisorAttendants'
  | 'supervisorAttendanceGroup'
  | 'sectorFilterId'
  | 'sectors'
  | 'isSupervisor'
>): string[] {
  const chips: string[] = [];
  const statusHandledByAttendanceGroup = props.isSupervisor && props.supervisorAttendanceGroup !== 'all';
  if (!statusHandledByAttendanceGroup) {
    const statusLabel = inboxStatusFilterLabel(props.statusFilter);
    if (statusLabel) chips.push(`Status: ${statusLabel}`);
  } else {
    const groupLabel =
      props.supervisorAttendanceGroup === 'active'
        ? 'Em andamento'
        : props.supervisorAttendanceGroup === 'waiting'
          ? 'Aguardando cliente'
          : 'Finalizados';
    chips.push(`Atendimentos: ${groupLabel}`);
  }
  const priorityLabel = inboxPriorityFilterLabel(props.priorityFilter);
  if (priorityLabel) chips.push(`Prioridade: ${priorityLabel}`);
  if (props.search.trim()) chips.push(`Busca: ${props.search.trim()}`);
  if (props.supervisorAttendantId) {
    const name = props.supervisorAttendants.find((a) => a.id === props.supervisorAttendantId)?.name || 'Atendente';
    chips.push(`Atendente: ${name}`);
  }
  if (props.sectorFilterId) {
    const name = props.sectors.find((s) => s.id === props.sectorFilterId)?.name || 'Setor';
    chips.push(`Setor: ${name}`);
  }
  return chips;
}

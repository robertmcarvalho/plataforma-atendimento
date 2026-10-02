'use client';

import { Calendar } from 'lucide-react';
import { ToolbarSelect } from '@/components/form/ToolbarSelect';
import { ListToolbar } from '@/components/ui/ListToolbar';
import { formatDateBr } from '@/lib/datetimeBr';
import { reviveToolbarButtonClassName } from '@/lib/reviveSurfaces';
import type { InstallmentSettlementFilter } from '@/lib/financial/types';
import { cn } from '@/lib/utils';

export type FinancialFiltersProps = {
  search: string;
  onSearchChange: (value: string) => void;
  selectedCycleStart: string;
  onSelectedCycleStartChange: (value: string) => void;
  leaderFilter: string;
  onLeaderFilterChange: (value: string) => void;
  leadersList?: Array<{ id: string; name: string }>;
  pharmacyFilter: string;
  onPharmacyFilterChange: (value: string) => void;
  pharmaciesList?: Array<{ id: string; trade_name: string }>;
  installmentFilter: InstallmentSettlementFilter;
  onInstallmentFilterChange: (value: InstallmentSettlementFilter) => void;
  typeFilter: string;
  onTypeFilterChange: (value: string) => void;
  typeLabels: Record<string, string>;
  statusFilter: string;
  onTogglePendingApproval: () => void;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
};

export function FinancialFilters({
  search,
  onSearchChange,
  selectedCycleStart,
  onSelectedCycleStartChange,
  leaderFilter,
  onLeaderFilterChange,
  leadersList,
  pharmacyFilter,
  onPharmacyFilterChange,
  pharmaciesList,
  installmentFilter,
  onInstallmentFilterChange,
  typeFilter,
  onTypeFilterChange,
  typeLabels,
  statusFilter,
  onTogglePendingApproval,
  hasActiveFilters,
  onClearFilters,
}: FinancialFiltersProps) {
  return (
    <ListToolbar searchValue={search} onSearchChange={onSearchChange} searchPlaceholder="Buscar entregador ou justificativa…">
      <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
        <Calendar className="h-3 w-3 text-muted-foreground" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase">Data de referência</span>
        <input
          type="date"
          lang="pt-BR"
          value={selectedCycleStart}
          onChange={(e) => onSelectedCycleStartChange(e.target.value)}
          className="bg-transparent border-none text-xs font-mono outline-none text-foreground cursor-pointer min-w-[7.5rem]"
          title={formatDateBr(selectedCycleStart)}
        />
      </div>
      <ToolbarSelect
        wideMenu
        value={leaderFilter}
        onChange={onLeaderFilterChange}
        aria-label="Filtrar por líder"
        options={[
          { value: '', label: 'Todos os líderes' },
          ...(leadersList || []).map((l) => ({ value: l.id, label: l.name })),
        ]}
      />
      <ToolbarSelect
        wideMenu
        value={pharmacyFilter}
        onChange={onPharmacyFilterChange}
        aria-label="Filtrar por farmácia"
        className="max-w-[12rem] truncate"
        options={[
          { value: '', label: 'Todas as farmácias' },
          ...(pharmaciesList || []).map((p) => ({ value: p.id, label: p.trade_name })),
        ]}
      />
      <ToolbarSelect
        value={installmentFilter}
        onChange={(v) => onInstallmentFilterChange(v as InstallmentSettlementFilter)}
        aria-label="Filtrar por status"
        options={[
          { value: 'all', label: 'Status: todos' },
          { value: 'pending', label: 'Pendente' },
          { value: 'paid', label: 'Pago' },
          { value: 'discounted', label: 'Descontado' },
        ]}
      />
      <ToolbarSelect
        value={typeFilter}
        onChange={onTypeFilterChange}
        aria-label="Filtrar por tipo"
        options={[
          { value: 'all', label: 'Todos os Tipos' },
          ...Object.entries(typeLabels).map(([val, label]) => ({ value: val, label })),
        ]}
      />
      <button
        type="button"
        onClick={onTogglePendingApproval}
        className={cn(
          'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
          statusFilter === 'pending_approval'
            ? 'border-warning bg-warning/10 text-warning'
            : 'border-border bg-surface text-muted-foreground hover:bg-sidebar-accent/60'
        )}
      >
        Aguard. aprovação
      </button>
      {hasActiveFilters ? (
        <button type="button" onClick={onClearFilters} className={reviveToolbarButtonClassName}>
          Limpar filtros
        </button>
      ) : null}
    </ListToolbar>
  );
}

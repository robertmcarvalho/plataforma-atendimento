'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardList, Clock, Plus, Search, Trash2, Zap } from 'lucide-react';
import {
  OPS_TASK_AUTOMATION_EVENT_LABELS,
  OPS_TASK_TRIGGER_LABELS,
  TASK_TYPE_SLUG_RE,
  type OpsTaskAutomationRule,
  type OpsTaskCatalogEntry,
  type OpsTaskTrigger,
} from '@plataforma/ops-task-catalog';
import api from '@/lib/api';
import { onApiError } from '@/lib/apiErrorMessage';
import { cadastroSwitchRowClassName } from '@/components/cadastro/CadastroPrimitives';
import { cn } from '@/lib/utils';
import { FormControl } from '@/components/form/FormControl';
import { Button } from '@/components/ui/button';
import { FilterChips } from '@/components/ui/FilterChips';
import { Switch } from '@/components/ui/Switch';
import { iconButtonHover, interactiveActive, interactiveHover } from '@/lib/interactiveRow';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';

type PlaybookStep = { id: string; label: string };
type PlaybooksConfig = Record<string, { steps: PlaybookStep[]; permissions?: string[] }>;
type SlaEntry = {
  sla_minutes: number;
  warning_pct?: number;
  reminder_minutes?: number;
  escalate_after_x?: number;
  signature_deadline_days?: number;
};
type SlaConfig = Record<string, SlaEntry>;

type OperacaoTaskConfig = {
  catalog: OpsTaskCatalogEntry[];
  playbooks: PlaybooksConfig;
  sla: SlaConfig;
  automation_rules: OpsTaskAutomationRule[];
};

type DetailTab = 'geral' | 'checklist' | 'sla' | 'automacao';

function minutesLabel(m: number): string {
  if (m < 60) return `${m} min`;
  if (m < 1440) return `${Math.round(m / 60)} h`;
  return `${Math.round(m / 1440)} d`;
}

function newRuleId() {
  return `rule_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function SettingsOperacaoPanel({ isAdmin }: { isAdmin: boolean }) {
  const qc = useQueryClient();
  const [selectedType, setSelectedType] = useState('');
  const [detailTab, setDetailTab] = useState<DetailTab>('geral');
  const [search, setSearch] = useState('');
  const [catalog, setCatalog] = useState<OpsTaskCatalogEntry[]>([]);
  const [playbooks, setPlaybooks] = useState<PlaybooksConfig>({});
  const [sla, setSla] = useState<SlaConfig>({});
  const [automationRules, setAutomationRules] = useState<OpsTaskAutomationRule[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [showNewType, setShowNewType] = useState(false);
  const [newTypeSlug, setNewTypeSlug] = useState('');
  const [newTypeLabel, setNewTypeLabel] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['settings', 'operacao-task-config'],
    queryFn: async () => (await api.get<OperacaoTaskConfig>('/api/settings/operacao-task-config')).data,
  });

  useEffect(() => {
    if (!data) return;
    const entries = data.catalog || [];
    setCatalog(entries);
    setPlaybooks(data.playbooks || {});
    setSla(data.sla || {});
    setAutomationRules(data.automation_rules || []);
    setSelectedType((cur) => {
      if (cur && entries.some((e) => e.task_type === cur)) return cur;
      return entries[0]?.task_type || '';
    });
  }, [data]);

  const saveCatalog = useMutation({
    mutationFn: async (entries: OpsTaskCatalogEntry[]) => {
      await api.put('/api/settings', { key: 'ops_task_catalog', value: { entries } });
    },
    onSuccess: async () => {
      setNote('Catálogo salvo.');
      await qc.invalidateQueries({ queryKey: ['settings', 'operacao-task-config'] });
    },
    onError: onApiError(setNote, 'Erro ao salvar catálogo.'),
  });

  const savePlaybooks = useMutation({
    mutationFn: async () => {
      await api.put('/api/settings', { key: 'ops_task_playbooks', value: playbooks });
    },
    onSuccess: async () => {
      setNote('Checklist salvo.');
      await qc.invalidateQueries({ queryKey: ['settings', 'operacao-task-config'] });
      await qc.invalidateQueries({ queryKey: ['ops-analytics'] });
    },
    onError: onApiError(setNote, 'Erro ao salvar checklist.'),
  });

  const saveSla = useMutation({
    mutationFn: async () => {
      await api.put('/api/settings', { key: 'ops_task_sla_config', value: sla });
    },
    onSuccess: async () => {
      setNote('SLA salvo.');
      await qc.invalidateQueries({ queryKey: ['settings', 'operacao-task-config'] });
      await qc.invalidateQueries({ queryKey: ['ops-analytics'] });
    },
    onError: onApiError(setNote, 'Erro ao salvar SLA.'),
  });

  const saveAutomation = useMutation({
    mutationFn: async (rules: OpsTaskAutomationRule[]) => {
      await api.put('/api/settings', { key: 'ops_task_automation_rules', value: { rules } });
    },
    onSuccess: async () => {
      setNote('Regras de automação salvas.');
      await qc.invalidateQueries({ queryKey: ['settings', 'operacao-task-config'] });
    },
    onError: onApiError(setNote, 'Erro ao salvar automação.'),
  });

  const filteredCatalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return catalog;
    return catalog.filter(
      (e) => e.label.toLowerCase().includes(q) || e.task_type.toLowerCase().includes(q)
    );
  }, [catalog, search]);

  const selectedEntry = catalog.find((e) => e.task_type === selectedType);
  const currentSteps = playbooks[selectedType]?.steps || [];
  const currentSla = sla[selectedType] || { sla_minutes: 2880 };
  const typeRules = automationRules.filter((r) => r.task_type === selectedType);

  const updateStep = (index: number, label: string) => {
    const steps = [...currentSteps];
    steps[index] = { ...steps[index], label };
    setPlaybooks((p) => ({ ...p, [selectedType]: { ...p[selectedType], steps } }));
  };

  const addStep = () => {
    const id = `step_${currentSteps.length + 1}`;
    setPlaybooks((p) => ({
      ...p,
      [selectedType]: {
        ...p[selectedType],
        steps: [...currentSteps, { id, label: 'Novo passo' }],
      },
    }));
  };

  const removeStep = (index: number) => {
    const steps = currentSteps.filter((_, i) => i !== index);
    setPlaybooks((p) => ({ ...p, [selectedType]: { ...p[selectedType], steps } }));
  };

  const updateSlaField = (field: keyof SlaEntry, raw: string) => {
    const num = Number(raw);
    if (!Number.isFinite(num)) return;
    setSla((s) => ({
      ...s,
      [selectedType]: { ...s[selectedType], sla_minutes: s[selectedType]?.sla_minutes ?? 2880, [field]: num },
    }));
  };

  const updateCatalogField = (
    taskType: string,
    patch: Partial<OpsTaskCatalogEntry>,
    options?: { persist?: boolean }
  ) => {
    setCatalog((rows) => {
      const next = rows.map((r) => (r.task_type === taskType ? { ...r, ...patch } : r));
      if (options?.persist && isAdmin) {
        void saveCatalog.mutate(next);
      }
      return next;
    });
  };

  const addCustomType = () => {
    const slug = newTypeSlug.trim().toLowerCase().replace(/\s+/g, '_');
    const label = newTypeLabel.trim();
    if (!slug || !label) return;
    if (!TASK_TYPE_SLUG_RE.test(slug)) {
      setNote('Identificador inválido. Use snake_case (ex.: custom_onboarding).');
      return;
    }
    if (catalog.some((e) => e.task_type === slug)) {
      setNote('Já existe um tipo com esse identificador.');
      return;
    }
    const entry: OpsTaskCatalogEntry = {
      task_type: slug,
      label,
      builtin: false,
      enabled: true,
      manual_create: true,
      triggers: ['manual', 'mcp'],
      icon: 'ClipboardList',
      tone: 'muted',
      title_template: `${label}: {driver_name}`,
    };
    const next = [...catalog, entry];
    setCatalog(next);
    setPlaybooks((p) => ({
      ...p,
      [slug]: {
        steps: [
          { id: 'review', label: 'Revisar contexto' },
          { id: 'act', label: 'Executar ação' },
          { id: 'close', label: 'Concluir' },
        ],
      },
    }));
    setSla((s) => ({ ...s, [slug]: { sla_minutes: 2880 } }));
    setSelectedType(slug);
    setShowNewType(false);
    setNewTypeSlug('');
    setNewTypeLabel('');
  };

  const removeCustomType = (taskType: string) => {
    setCatalog((rows) => rows.filter((e) => e.task_type !== taskType));
    setAutomationRules((rules) => rules.filter((r) => r.task_type !== taskType));
    if (selectedType === taskType) {
      const rest = catalog.filter((e) => e.task_type !== taskType);
      setSelectedType(rest[0]?.task_type || '');
    }
  };

  const addAutomationRule = () => {
    if (!selectedType) return;
    setAutomationRules((rules) => [
      ...rules,
      {
        id: newRuleId(),
        event: 'internal_note_pattern',
        task_type: selectedType,
        enabled: true,
        pattern: '',
      },
    ]);
  };

  const updateRule = (id: string, patch: Partial<OpsTaskAutomationRule>, options?: { persist?: boolean }) => {
    setAutomationRules((rules) => {
      const next = rules.map((r) => (r.id === id ? { ...r, ...patch } : r));
      if (options?.persist && isAdmin) {
        void saveAutomation.mutate(next);
      }
      return next;
    });
  };

  const removeRule = (id: string) => {
    setAutomationRules((rules) => rules.filter((r) => r.id !== id));
  };

  if (isLoading) {
    return (
      <div className="space-y-3 rounded-xl border border-border bg-background p-6">
        <div className="h-4 w-48 animate-pulse rounded bg-muted" />
        <div className="h-32 animate-pulse rounded-lg bg-muted/60" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Catálogo unificado de tipos de tarefa. Selecione um tipo para configurar checklist, SLA e gatilhos automáticos.
        Alterações aplicam-se a novas tarefas no painel <span className="font-mono">/operacao</span>.
      </p>

      <div className="grid min-h-[480px] gap-4 lg:grid-cols-[minmax(260px,300px)_1fr]">
        {/* Catálogo — lista lateral */}
        <div className="flex min-h-0 flex-col rounded-xl border border-border bg-background p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold">Catálogo de tipos</h3>
            {isAdmin ? (
              <Button
                type="button"
                variant="outline"
                size="xs"
                className={reviveOutlineButtonClassName}
                onClick={() => setShowNewType((v) => !v)}
              >
                <Plus className="mr-1 inline h-3 w-3" />
                Novo
              </Button>
            ) : null}
          </div>

          <div className="relative mb-3">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <FormControl
              className="pl-8 text-xs"
              placeholder="Buscar tipo…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {showNewType && isAdmin ? (
            <div className="mb-3 space-y-2 rounded-lg border border-border bg-surface p-3">
              <FormControl
                className="font-mono text-xs"
                value={newTypeSlug}
                onChange={(e) => setNewTypeSlug(e.target.value)}
                placeholder="identificador_snake_case"
              />
              <FormControl
                value={newTypeLabel}
                onChange={(e) => setNewTypeLabel(e.target.value)}
                placeholder="Nome exibido"
              />
              <Button type="button" size="xs" onClick={addCustomType}>
                Adicionar
              </Button>
            </div>
          ) : null}

          <ul className="min-h-0 flex-1 space-y-1 overflow-y-auto">
            {filteredCatalog.map((entry) => {
              const selected = entry.task_type === selectedType;
              const ruleCount = automationRules.filter((r) => r.task_type === entry.task_type && r.enabled).length;
              return (
                <li key={entry.task_type}>
                  <button
                    type="button"
                    onClick={() => setSelectedType(entry.task_type)}
                    className={cn(
                      'w-full rounded-lg border px-3 py-2.5 text-left transition-colors',
                      selected
                        ? cn('border-primary/40 bg-sidebar-accent/50', interactiveActive)
                        : cn('border-transparent', interactiveHover)
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={cn('text-sm font-medium', !entry.enabled && 'text-muted-foreground line-through')}>
                        {entry.label}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide',
                          entry.builtin
                            ? 'bg-muted text-muted-foreground'
                            : 'bg-primary/10 text-primary'
                        )}
                      >
                        {entry.builtin ? 'Built-in' : 'Custom'}
                      </span>
                    </div>
                    <p className="mt-0.5 font-mono text-[10px] text-subtle-foreground">{entry.task_type}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {entry.triggers.slice(0, 3).map((t) => (
                        <span
                          key={t}
                          className="rounded bg-muted/80 px-1 py-0.5 text-[9px] text-muted-foreground"
                        >
                          {OPS_TASK_TRIGGER_LABELS[t as OpsTaskTrigger]?.split(' ')[0] || t}
                        </span>
                      ))}
                      {entry.triggers.length > 3 ? (
                        <span className="text-[9px] text-muted-foreground">+{entry.triggers.length - 3}</span>
                      ) : null}
                      {ruleCount > 0 ? (
                        <span className="rounded bg-warning/15 px-1 py-0.5 text-[9px] text-warning">
                          {ruleCount} auto
                        </span>
                      ) : null}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {isAdmin ? (
            <Button
              type="button"
              className="mt-3 w-full text-xs"
              variant="outline"
              disabled={saveCatalog.isPending}
              onClick={() => void saveCatalog.mutate(catalog)}
            >
              Salvar catálogo
            </Button>
          ) : null}
        </div>

        {/* Detalhe do tipo selecionado */}
        <div className="flex min-h-0 flex-col rounded-xl border border-border bg-background p-6">
          {!selectedEntry ? (
            <p className="text-sm text-muted-foreground">Selecione um tipo no catálogo.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-base font-semibold">{selectedEntry.label}</h3>
                  <p className="font-mono text-xs text-muted-foreground">{selectedEntry.task_type}</p>
                </div>
                <label className={cn(cadastroSwitchRowClassName, 'gap-2 text-xs')}>
                  <span className="text-muted-foreground">Ativo</span>
                  <Switch
                    checked={selectedEntry.enabled}
                    disabled={!isAdmin}
                    onCheckedChange={(v) =>
                      updateCatalogField(selectedEntry.task_type, { enabled: v }, { persist: true })
                    }
                  />
                </label>
              </div>

              <FilterChips
                items={[
                  { id: 'geral', label: 'Geral' },
                  { id: 'checklist', label: 'Checklist' },
                  { id: 'sla', label: 'SLA' },
                  { id: 'automacao', label: 'Automação' },
                ]}
                value={detailTab}
                onChange={(id) => setDetailTab(id as DetailTab)}
                className="mb-5"
              />

              {detailTab === 'geral' ? (
                <div className="space-y-4">
                  {!selectedEntry.builtin && isAdmin ? (
                    <label className="block text-xs">
                      <span className="text-muted-foreground">Nome exibido</span>
                      <FormControl
                        className="mt-1"
                        value={selectedEntry.label}
                        onChange={(e) => updateCatalogField(selectedEntry.task_type, { label: e.target.value })}
                      />
                    </label>
                  ) : null}
                  {!selectedEntry.builtin && isAdmin ? (
                    <label className="block text-xs">
                      <span className="text-muted-foreground">Modelo de título</span>
                      <FormControl
                        className="mt-1 font-mono text-xs"
                        value={selectedEntry.title_template}
                        onChange={(e) =>
                          updateCatalogField(selectedEntry.task_type, { title_template: e.target.value })
                        }
                        placeholder="{driver_name}"
                      />
                      <p className="mt-1 text-[10px] text-muted-foreground">Variável disponível: {'{driver_name}'}</p>
                    </label>
                  ) : null}
                  <div>
                    <p className="mb-2 text-xs font-medium text-muted-foreground">Gatilhos permitidos</p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedEntry.triggers.map((t) => (
                        <span
                          key={t}
                          className="rounded-md border border-border bg-surface px-2 py-1 text-[11px] text-foreground"
                        >
                          {OPS_TASK_TRIGGER_LABELS[t as OpsTaskTrigger] || t}
                        </span>
                      ))}
                    </div>
                    {!selectedEntry.builtin ? (
                      <p className="mt-2 text-[10px] text-muted-foreground">
                        Tipos custom recebem gatilhos automáticos ao configurar regras na aba Automação.
                      </p>
                    ) : null}
                  </div>
                  {selectedEntry.manual_create ? (
                    <p className="text-xs text-muted-foreground">Criação manual habilitada em /operacao.</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Somente gatilhos automáticos — sem criação manual.</p>
                  )}
                  {!selectedEntry.builtin && isAdmin ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="xs"
                      className="text-destructive"
                      onClick={() => removeCustomType(selectedEntry.task_type)}
                    >
                      <Trash2 className="mr-1 inline h-3 w-3" />
                      Remover tipo custom
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {detailTab === 'checklist' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                      <ClipboardList className="h-4 w-4 text-primary" />
                      Passos do checklist
                    </h4>
                    {isAdmin ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className={reviveOutlineButtonClassName}
                        onClick={addStep}
                      >
                        <Plus className="mr-1 inline h-3 w-3" />
                        Adicionar passo
                      </Button>
                    ) : null}
                  </div>
                  {currentSteps.length === 0 ? (
                    <p className="text-xs text-muted-foreground">Nenhum passo configurado. Adicione o primeiro passo.</p>
                  ) : (
                    <ul className="space-y-2">
                      {currentSteps.map((step, i) => (
                        <li key={step.id} className="flex items-center gap-2">
                          <span className="w-6 font-mono text-[10px] text-muted-foreground">{i + 1}</span>
                          <FormControl
                            className="flex-1"
                            value={step.label}
                            disabled={!isAdmin}
                            onChange={(e) => updateStep(i, e.target.value)}
                          />
                          {isAdmin ? (
                            <button
                              type="button"
                              className={iconButtonHover}
                              onClick={() => removeStep(i)}
                              aria-label="Remover passo"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isAdmin ? (
                    <Button
                      type="button"
                      className="text-xs"
                      disabled={savePlaybooks.isPending}
                      onClick={() => void savePlaybooks.mutate()}
                    >
                      Salvar checklist
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {detailTab === 'sla' ? (
                <div className="space-y-3">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <Clock className="h-4 w-4 text-primary" />
                    Prazos
                    <span className="text-xs font-normal text-muted-foreground">
                      ({minutesLabel(currentSla.sla_minutes)})
                    </span>
                  </h4>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-xs">
                      <span className="text-muted-foreground">Prazo (minutos)</span>
                      <FormControl
                        type="number"
                        min={15}
                        max={43200}
                        className="mt-1"
                        disabled={!isAdmin}
                        value={currentSla.sla_minutes}
                        onChange={(e) => updateSlaField('sla_minutes', e.target.value)}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="text-muted-foreground">Alerta em % do SLA (0–1)</span>
                      <FormControl
                        type="number"
                        min={0.1}
                        max={0.99}
                        step={0.05}
                        className="mt-1"
                        disabled={!isAdmin}
                        value={currentSla.warning_pct ?? 0.8}
                        onChange={(e) => updateSlaField('warning_pct', e.target.value)}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="text-muted-foreground">Lembrete (min antes)</span>
                      <FormControl
                        type="number"
                        min={5}
                        className="mt-1"
                        disabled={!isAdmin}
                        value={currentSla.reminder_minutes ?? 30}
                        onChange={(e) => updateSlaField('reminder_minutes', e.target.value)}
                      />
                    </label>
                    <label className="text-xs">
                      <span className="text-muted-foreground">Prazo assinatura (dias)</span>
                      <FormControl
                        type="number"
                        min={1}
                        max={30}
                        className="mt-1"
                        disabled={!isAdmin}
                        value={currentSla.signature_deadline_days ?? 5}
                        onChange={(e) => updateSlaField('signature_deadline_days', e.target.value)}
                      />
                    </label>
                    <label className="text-xs sm:col-span-2">
                      <span className="text-muted-foreground">Escalar após X ocorrências</span>
                      <FormControl
                        type="number"
                        min={1}
                        className="mt-1"
                        disabled={!isAdmin}
                        value={currentSla.escalate_after_x ?? ''}
                        onChange={(e) => updateSlaField('escalate_after_x', e.target.value)}
                        placeholder="Opcional"
                      />
                    </label>
                  </div>
                  {isAdmin ? (
                    <Button
                      type="button"
                      className="text-xs"
                      disabled={saveSla.isPending}
                      onClick={() => void saveSla.mutate()}
                    >
                      Salvar SLA
                    </Button>
                  ) : null}
                </div>
              ) : null}

              {detailTab === 'automacao' ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                      <Zap className="h-4 w-4 text-warning" />
                      Gatilhos automáticos
                    </h4>
                    {isAdmin ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        className={reviveOutlineButtonClassName}
                        onClick={addAutomationRule}
                      >
                        <Plus className="mr-1 inline h-3 w-3" />
                        Nova regra
                      </Button>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Regras criam tarefas automaticamente quando o evento ocorre. O tipo recebe o gatilho correspondente
                    ao salvar.
                  </p>
                  {typeRules.length === 0 ? (
                    <p className="rounded-lg border border-dashed border-border px-4 py-6 text-center text-xs text-muted-foreground">
                      Nenhuma regra para este tipo. Adicione uma regra de nota interna ou documento.
                    </p>
                  ) : (
                    <ul className="space-y-3">
                      {typeRules.map((rule) => (
                        <li key={rule.id} className="rounded-lg border border-border bg-surface p-3">
                          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                            <label className={cn(cadastroSwitchRowClassName, 'gap-2 text-xs')}>
                              <Switch
                                checked={rule.enabled}
                                disabled={!isAdmin}
                                onCheckedChange={(v) => updateRule(rule.id, { enabled: v }, { persist: true })}
                              />
                              <span>Ativa</span>
                            </label>
                            {isAdmin ? (
                              <button
                                type="button"
                                className={iconButtonHover}
                                onClick={() => removeRule(rule.id)}
                                aria-label="Remover regra"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            ) : null}
                          </div>
                          <label className="mb-2 block text-xs">
                            <span className="text-muted-foreground">Evento</span>
                            <select
                              className="mt-1 w-full rounded-md border border-border bg-background px-2 py-1.5 text-xs"
                              disabled={!isAdmin}
                              value={rule.event}
                              onChange={(e) =>
                                updateRule(rule.id, {
                                  event: e.target.value as OpsTaskAutomationRule['event'],
                                  pattern: undefined,
                                  days_before: undefined,
                                })
                              }
                            >
                              {Object.entries(OPS_TASK_AUTOMATION_EVENT_LABELS).map(([k, label]) => (
                                <option key={k} value={k}>
                                  {label}
                                </option>
                              ))}
                            </select>
                          </label>
                          {rule.event === 'internal_note_pattern' ? (
                            <label className="block text-xs">
                              <span className="text-muted-foreground">Padrão (regex, flag i)</span>
                              <FormControl
                                className="mt-1 font-mono text-xs"
                                disabled={!isAdmin}
                                value={rule.pattern || ''}
                                onChange={(e) => updateRule(rule.id, { pattern: e.target.value })}
                                placeholder="finalizar\s+cadastro|onboarding"
                              />
                            </label>
                          ) : null}
                          {rule.event === 'driver_doc_expiring' ? (
                            <label className="block text-xs">
                              <span className="text-muted-foreground">Dias antes do vencimento</span>
                              <FormControl
                                type="number"
                                min={1}
                                max={90}
                                className="mt-1"
                                disabled={!isAdmin}
                                value={rule.days_before ?? 30}
                                onChange={(e) => updateRule(rule.id, { days_before: Number(e.target.value) })}
                              />
                            </label>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  )}
                  {isAdmin ? (
                    <Button
                      type="button"
                      className="text-xs"
                      disabled={saveAutomation.isPending}
                      onClick={() => void saveAutomation.mutate(automationRules)}
                    >
                      Salvar automação
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </div>
      </div>

      {note ? (
        <p className={cn('text-xs', note.toLowerCase().includes('erro') ? 'text-destructive' : 'text-success')}>
          {note}
        </p>
      ) : null}
      {!isAdmin ? (
        <p className="text-xs text-amber-600">Somente administradores podem alterar configurações de Operação.</p>
      ) : null}
    </div>
  );
}

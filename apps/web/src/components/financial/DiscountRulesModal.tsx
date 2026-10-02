'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format, parse, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import {
  AlertCircle,
  CheckCircle2,
  ChevronRight,
  Clock,
  DollarSign,
  FileSpreadsheet,
  Info,
  Link2,
  MessageSquare,
  Settings2,
  Upload,
  X,
} from 'lucide-react';
import { FormControl, formTextareaClassName } from '@/components/form/FormControl';
import { FormSelect } from '@/components/form/FormSelect';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { useAuth } from '@/store/auth';
import { formatBRL } from '@/lib/brFormat';
import { formatDateBr, formatDateTimeBr } from '@/lib/datetimeBr';
import {
  RULE_KIND_LABELS,
  type DiscountRule,
  type DiscountRuleKind,
} from '@/lib/financialCycle';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';
import { buildDefaultRule, WEEK_DAYS } from '@/lib/financial/financialDiscountRules';
import { useEntryTypes, useTypeLabels } from '@/lib/financial/entryTypesContext';
import {
  absenceDispositionLabel,
  coverageRoleLabel,
  entryStatusLabel,
  frequencyLabel,
  inferEntryOrigin,
  occurrenceKindLabel,
  userRoleLabel,
} from '@/lib/financial/financialLabels';
import {
  buildCoverageMaps,
  coverageListHint,
  resolveCoverageAbsence,
  resolveCoverageDailies,
  resolveLinkedEntryId,
} from '@/lib/financial/financialCoverage';
import {
  formatRequestAtSaoPaulo,
  installmentStatusLabel,
  installmentsOnReferenceDate,
} from '@/lib/financial/financialInstallments';
import type { ApiEntry, DriverOption, PharmacyOption } from '@/lib/financial/types';
import { RecalculateEntriesButton } from '@/components/financial/RecalculateEntriesButton';

export function DiscountRulesModal({
  rules,
  onClose,
  onSave,
}: {
  rules: Record<string, DiscountRule>;
  onClose: () => void;
  onSave: (rules: Record<string, DiscountRule>) => void;
}) {
  const queryClient = useQueryClient();
  const { types, labels } = useEntryTypes();
  const [draftRules, setDraftRules] = useState<Record<string, DiscountRule>>(rules);
  const [showAddType, setShowAddType] = useState(false);
  const [newSlug, setNewSlug] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newAffects, setNewAffects] = useState<'discount' | 'daily' | 'ignore'>('discount');
  const [creatingType, setCreatingType] = useState(false);
  const [typeError, setTypeError] = useState<string | null>(null);

  useEffect(() => {
    setDraftRules(rules);
  }, [rules]);

  const updateRule = (type: string, updates: Partial<DiscountRule>) => {
    setDraftRules((prev) => ({
      ...prev,
      [type]: {
        ...(prev[type] ?? buildDefaultRule(type)),
        ...updates,
      },
    }));
  };

  const handleSave = () => {
    onSave(draftRules);
    onClose();
  };

  const visibleTypes = useMemo(() => {
    // Tipos do catálogo (ativos) + qualquer slug com regra editada que não esteja no catálogo (legado).
    const map = new Map<string, string>();
    for (const t of types) {
      if (t.active) map.set(t.slug, t.label);
    }
    for (const slug of Object.keys(draftRules)) {
      if (!map.has(slug)) map.set(slug, labels[slug] ?? slug);
    }
    return Array.from(map.entries());
  }, [types, draftRules, labels]);

  const handleCreateType = async () => {
    setTypeError(null);
    const slug = newSlug.trim().toLowerCase();
    const label = newLabel.trim();
    if (!/^[a-z][a-z0-9_]{0,30}$/.test(slug)) {
      setTypeError('Slug inválido. Use letras minúsculas, números e _ (3-30 chars).');
      return;
    }
    if (label.length < 1) {
      setTypeError('Informe um rótulo para o tipo.');
      return;
    }
    setCreatingType(true);
    try {
      await api.post('/api/financial/entry-types', { slug, label, affects_net: newAffects });
      await queryClient.invalidateQueries({ queryKey: ['financial-entry-types'] });
      await queryClient.invalidateQueries({ queryKey: ['financial-discount-rules'] });
      setNewSlug('');
      setNewLabel('');
      setNewAffects('discount');
      setShowAddType(false);
    } catch (e: unknown) {
      setTypeError(apiErrorMessage(e, 'Falha ao criar tipo de lançamento.'));
    } finally {
      setCreatingType(false);
    }
  };

  const handleToggleActive = async (slug: string, active: boolean) => {
    try {
      await api.patch(`/api/financial/entry-types/${slug}`, { active });
      await queryClient.invalidateQueries({ queryKey: ['financial-entry-types'] });
    } catch (e: unknown) {
      window.alert(apiErrorMessage(e, 'Falha ao atualizar tipo.'));
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-2xl border border-border bg-card p-6 shadow-md overflow-hidden flex flex-col">
        <div className="mb-6 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-lg font-semibold">Configuração regras lançamento</h3>
              <p className="text-xs text-muted-foreground">Defina como cada tipo de lançamento deve ser filtrado pelo ciclo.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-sidebar-accent/60"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mb-4 rounded-xl border border-border bg-surface p-4">
            <div className="mb-2 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">Tipos de lançamento</div>
                <p className="text-[11px] text-muted-foreground">
                  Crie ou desative tipos personalizados. Tipos do sistema não podem ser apagados; o tipo
                  &quot;Diária&quot; não pode ser desativado.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowAddType((v) => !v)}
                className={reviveOutlineButtonClassName}
              >
                {showAddType ? 'Cancelar' : '+ Novo tipo'}
              </button>
            </div>

            {showAddType && (
              <div className="mt-3 grid gap-2 rounded-xl border border-border bg-background/40 p-3 sm:grid-cols-[1fr_2fr_140px_auto] sm:items-end">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">Slug</label>
                  <FormControl
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
                    placeholder="ex.: bonus_extra"
                    inputSize="sm"
                    className="font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">Rótulo</label>
                  <FormControl
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="ex.: Bônus extra"
                    inputSize="sm"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">Comportamento</label>
                  <FormSelect
                    size="sm"
                    value={newAffects}
                    onChange={(v) => setNewAffects(v as 'discount' | 'daily' | 'ignore')}
                    className="text-xs"
                    options={[
                      { value: 'discount', label: 'Desconto' },
                      { value: 'ignore', label: 'Não impacta' },
                    ]}
                  />
                </div>
                <Button type="button" size="xs" onClick={handleCreateType} disabled={creatingType}>
                  {creatingType ? 'Criando…' : 'Criar tipo'}
                </Button>
                {typeError && <div className="sm:col-span-4 text-[11px] text-destructive">{typeError}</div>}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {types.map((t) => (
                <span
                  key={t.slug}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]',
                    t.active ? 'border-primary/30 bg-primary/5 text-foreground' : 'border-border bg-muted/30 text-muted-foreground line-through'
                  )}
                >
                  {t.label}
                  <span className="font-mono text-[10px] text-muted-foreground">{t.slug}</span>
                  {!t.is_system || t.slug !== 'daily' ? (
                    <button
                      type="button"
                      onClick={() => handleToggleActive(t.slug, !t.active)}
                      className="rounded text-[10px] font-semibold uppercase text-muted-foreground hover:text-primary"
                      title={t.active ? 'Desativar' : 'Ativar'}
                    >
                      {t.active ? 'Desativar' : 'Ativar'}
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          </div>

          <div className="grid gap-4">
            {visibleTypes.map(([type, label]) => {
              const rule = draftRules[type] || buildDefaultRule(type);
              return (
                <div key={type} className="rounded-xl border border-border bg-surface p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{label}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{type}</div>
                    </div>
                    <FormSelect
                      size="sm"
                      value={rule.kind}
                      onChange={(v) => updateRule(type, { kind: v as DiscountRuleKind })}
                      className="w-auto min-w-[10rem] text-xs"
                      options={Object.entries(RULE_KIND_LABELS).map(([value, kindLabel]) => ({
                        value,
                        label: kindLabel,
                      }))}
                    />
                  </div>

                  {rule.kind === 'apuracao_cycle' ? (
                    <div className="space-y-3">
                      <p className="text-[11px] text-muted-foreground">
                        Falta: desconto no dia de pagamento da semana seguinte ao ciclo seg–dom do evento.
                      </p>
                      <div className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Dia de pagamento</label>
                        <div className="flex flex-wrap gap-2">
                          {WEEK_DAYS.map(({ value, label: dayLabel }) => (
                            <label key={value} className="flex items-center gap-1 text-xs">
                              <input
                                type="radio"
                                name={`absence-pay-${type}`}
                                checked={(rule.daysOfWeek[0] ?? 4) === value}
                                onChange={() => updateRule(type, { daysOfWeek: [value] })}
                              />
                              {dayLabel}
                            </label>
                          ))}
                        </div>
                      </div>
                    </div>
                  ) : rule.kind === 'weekly' ? (
                    <div className="space-y-3">
                      <div className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Dias da semana</label>
                        <div className="flex flex-wrap gap-2">
                          {WEEK_DAYS.map(({ value, label: dayLabel }) => (
                            <label key={value} className="flex items-center gap-1 text-xs">
                              <input
                                type="checkbox"
                                checked={rule.daysOfWeek.includes(value)}
                                onChange={(e) => {
                                  const newDays = e.target.checked 
                                    ? [...rule.daysOfWeek, value]
                                    : rule.daysOfWeek.filter(d => d !== value);
                                  updateRule(type, { daysOfWeek: newDays });
                                }}
                                className="rounded border border-border"
                              />
                              {dayLabel}
                            </label>
                          ))}
                        </div>
                      </div>
                      {type === 'daily' && (
                        <div className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
                          <label className="text-xs font-semibold uppercase text-muted-foreground">Corte horário</label>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-muted-foreground">Até</span>
                            <FormControl
                              type="number"
                              min={0}
                              max={23}
                              value={rule.submissionCutoffHour || 11}
                              onChange={(e) => updateRule(type, { submissionCutoffHour: Number(e.target.value) })}
                              inputSize="sm"
                              className="w-16 text-xs"
                            />
                            <span className="text-xs text-muted-foreground">horas do mesmo dia</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : rule.kind === 'monthly' ? (
                    <div className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
                      <label className="text-xs font-semibold uppercase text-muted-foreground">Dia do mês</label>
                      <FormControl
                        type="number"
                        min={1}
                        max={31}
                        value={rule.dayOfMonth}
                        onChange={(e) => updateRule(type, { dayOfMonth: Number(e.target.value) || 1 })}
                        inputSize="sm"
                        className="text-xs"
                      />
                    </div>
                  ) : rule.kind === 'monthly_weekday' ? (
                    <div className="space-y-3">
                      <div className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Ocorrência</label>
                        <FormSelect
                          size="sm"
                          value={String(rule.monthlyNth)}
                          onChange={(v) => updateRule(type, { monthlyNth: Number(v) })}
                          className="text-xs"
                          options={[
                            { value: '1', label: '1ª' },
                            { value: '2', label: '2ª' },
                            { value: '3', label: '3ª' },
                            { value: '4', label: '4ª' },
                            { value: '5', label: 'Última' },
                          ]}
                        />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Dia da semana</label>
                        <FormSelect
                          size="sm"
                          value={String(rule.monthlyWeekday)}
                          onChange={(v) => updateRule(type, { monthlyWeekday: Number(v) })}
                          className="text-xs"
                          options={WEEK_DAYS.map(({ value, label }) => ({
                            value: String(value),
                            label,
                          }))}
                        />
                      </div>
                    </div>
                  ) : rule.kind === 'immediate' ? (
                    <div className="rounded-lg border border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
                      Lançamentos desse tipo são descontados no ciclo em que ocorreram, baseado na data de criação.
                    </div>
                  ) : (
                    <div className="rounded-lg border border-border bg-background/40 p-3 text-[11px] text-muted-foreground">
                      Pagamentos desse tipo usam a data exata selecionada no filtro.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end flex-shrink-0">
          <RecalculateEntriesButton onClose={onClose} />
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancelar
          </Button>
          <Button size="sm" onClick={handleSave}>
            Salvar regras
          </Button>
        </div>
      </div>
    </div>
  );
}
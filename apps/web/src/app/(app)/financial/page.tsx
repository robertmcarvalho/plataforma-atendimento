'use client';

import { useEffect, useState, useMemo, useRef, createContext, useContext } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  Plus, 
  TrendingDown, 
  DollarSign, 
  AlertCircle, 
  CheckCircle2, 
  Clock, 
  Search,
  RefreshCw,
  X,
  Calendar,
  Wallet,
  MessageSquare,
  ChevronRight,
  Info,
  FileSpreadsheet,
  Upload,
  Settings2
} from "lucide-react";
import { PageHeader } from "@/components/ui/PageHeader";
import { cn } from "@/lib/utils";
import api from '@/lib/api';
import { useAuth } from '@/store/auth';
import { formatBRL } from '@/lib/brFormat';
import { formatDateBr, formatDateTimeBr } from '@/lib/datetimeBr';
import { 
  format, 
  startOfWeek, 
  parseISO,
  parse,
  addDays
} from 'date-fns';
import { ptBR } from 'date-fns/locale';

type EntryStatus = 'draft' | 'pending_approval' | 'approved' | 'active' | 'settled' | 'cancelled';
type InstallmentStatus = 'pending' | 'paid' | 'overdue' | 'cancelled';

interface ApiEntry {
  id: string;
  type: string;
  description: string | null;
  total_amount: number;
  installments_count: number;
  installment_amount: number;
  frequency: string;
  start_date: string;
  status: EntryStatus;
  notes?: string;
  created_at: string;
  updated_at?: string;
  approved_at?: string | null;
  rejection_reason?: string | null;
  drivers?: { id: string; name: string; cpf: string; phone: string; pix_key?: string } | null;
  pharmacies?: { id: string; trade_name: string } | null;
  created_by_user?: { id: string; name: string; role: string };
  approved_by_user?: { id: string; name: string } | null;
  financial_installments?: Array<{
    id: string;
    installment_number: number;
    amount: number;
    due_date: string;
    status: InstallmentStatus;
    paid_at: string | null;
  }>;
}

/**
 * Mapa default de rótulos PT-BR. Não inclui `fine` nem `adjustment` (descontinuados); estes
 * só aparecem se o tenant os tiver explicitamente ativos no catálogo carregado em runtime.
 */
const DEFAULT_TYPE_LABELS: Record<string, string> = {
  quota: 'Cota',
  bag: 'Bag',
  uniform: 'Camiseta/Uniforme',
  digital_cert: 'Certificado digital',
  advance: 'Adiantamento',
  absence: 'Falta',
  daily: 'Diária',
  other: 'Outro',
};

interface FinancialEntryTypeMeta {
  slug: string;
  label: string;
  active: boolean;
  is_system: boolean;
  affects_net: 'discount' | 'daily' | 'ignore';
}

function buildTypeLabels(types: FinancialEntryTypeMeta[] | undefined): Record<string, string> {
  if (!types || types.length === 0) return DEFAULT_TYPE_LABELS;
  const out: Record<string, string> = { ...DEFAULT_TYPE_LABELS };
  for (const t of types) {
    if (t.active) out[t.slug] = t.label;
  }
  return out;
}

interface EntryTypesCtx {
  types: FinancialEntryTypeMeta[];
  labels: Record<string, string>;
}

const EntryTypesContext = createContext<EntryTypesCtx>({ types: [], labels: DEFAULT_TYPE_LABELS });

function useEntryTypes(): EntryTypesCtx {
  return useContext(EntryTypesContext);
}

function useTypeLabels(): Record<string, string> {
  return useContext(EntryTypesContext).labels;
}

type DiscountRuleKind = 'exact' | 'weekly' | 'monthly' | 'monthly_weekday' | 'immediate';

interface DiscountRule {
  type: string;
  kind: DiscountRuleKind;
  daysOfWeek: number[]; // múltiplos dias da semana
  dayOfMonth: number;
  monthlyNth: number; // para "nth" weekday do mês
  monthlyWeekday: number; // dia da semana para regras mensais
  submissionCutoffHour?: number; // horário limite para diárias
  submissionCutoffDay?: number; // dia da semana limite para diárias
}

const DEFAULT_DISCOUNT_RULES: Record<string, DiscountRule> = {
  quota: { type: 'quota', kind: 'monthly_weekday', daysOfWeek: [], dayOfMonth: 0, monthlyNth: 2, monthlyWeekday: 4 }, // 2ª quinta-feira do mês
  bag: { type: 'bag', kind: 'weekly', daysOfWeek: [2, 4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 }, // terça e quinta
  uniform: { type: 'uniform', kind: 'weekly', daysOfWeek: [2, 4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 }, // terça e quinta
  digital_cert: { type: 'digital_cert', kind: 'monthly_weekday', daysOfWeek: [], dayOfMonth: 0, monthlyNth: 2, monthlyWeekday: 4 }, // 2ª quinta-feira do mês
  advance: { type: 'advance', kind: 'weekly', daysOfWeek: [4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 }, // quinta-feira
  absence: { type: 'absence', kind: 'immediate', daysOfWeek: [], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 }, // desconto no ciclo atual
  daily: { type: 'daily', kind: 'weekly', daysOfWeek: [2, 4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0, submissionCutoffHour: 11, submissionCutoffDay: 0 }, // terça e quinta, cutoff 11:00 do mesmo dia
  other: { type: 'other', kind: 'weekly', daysOfWeek: [4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 },
};

function buildDefaultRule(type: string): DiscountRule {
  return DEFAULT_DISCOUNT_RULES[type]
    ?? { type, kind: 'weekly', daysOfWeek: [4], dayOfMonth: 0, monthlyNth: 0, monthlyWeekday: 0 };
}

const RULE_KIND_LABELS: Record<DiscountRuleKind, string> = {
  exact: 'Data exata',
  weekly: 'Dias da semana',
  monthly: 'Dia do mês',
  monthly_weekday: 'Ocorrência mensal',
  immediate: 'Imediato',
};

const WEEK_DAYS = [
  { value: 1, label: 'Segunda' },
  { value: 2, label: 'Terça' },
  { value: 3, label: 'Quarta' },
  { value: 4, label: 'Quinta' },
  { value: 5, label: 'Sexta' },
  { value: 6, label: 'Sábado' },
  { value: 7, label: 'Domingo' },
];

const statusMeta: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active: { label: "Ativo", color: "bg-primary/15 text-primary", icon: Clock },
  settled: { label: "Quitado", color: "bg-success/15 text-success", icon: CheckCircle2 },
  overdue: { label: "Vencido", color: "bg-destructive/15 text-destructive", icon: AlertCircle },
  pending_approval: { label: "Pendente", color: "bg-warning/15 text-warning", icon: Clock },
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground", icon: Clock },
  cancelled: { label: "Cancelado", color: "bg-muted text-muted-foreground", icon: CheckCircle2 },
};

function ImportBillingModal({ onClose, onImported }: { onClose: () => void, onImported: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await api.post('/api/financial/import-billing', formData, {
        headers: { 'Content-Type': 'multipart/form-data' }
      });
      onImported();
      onClose();
    } catch {
      alert('Erro ao importar faturamento. Verifique o formato do arquivo.');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 shadow-glow">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5 text-success" />
            <h3 className="text-lg font-semibold">Importar Faturamento</h3>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-surface-hover"><X className="h-5 w-5" /></button>
        </div>

        <div 
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "group cursor-pointer rounded-xl border-2 border-dashed border-border bg-surface-elevated/30 p-10 text-center transition-all hover:border-primary/50 hover:bg-primary/5",
            file && "border-success/50 bg-success/5"
          )}
        >
          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            accept=".xlsx,.xls,.csv" 
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <div className="flex flex-col items-center gap-2">
            <Upload className={cn("h-8 w-8 text-muted-foreground group-hover:text-primary transition-colors", file && "text-success")} />
            <div className="text-sm font-medium">{file ? file.name : 'Clique para selecionar o Excel'}</div>
            <div className="text-[10px] text-muted-foreground uppercase font-bold">Colunas esperadas: Nome, CPF, Valor</div>
          </div>
        </div>

        <div className="mt-6 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-md border border-border py-2 text-xs font-medium">Cancelar</button>
          <button 
            disabled={!file || uploading} 
            onClick={handleUpload}
            className="flex-1 rounded-md bg-primary py-2 text-xs font-bold text-primary-foreground disabled:opacity-50"
          >
            {uploading ? 'Processando...' : 'Iniciar Importação'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DiscountRulesModal({
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
      const err = e as { response?: { data?: { error?: string } } };
      setTypeError(err.response?.data?.error ?? 'Falha ao criar tipo de lançamento.');
    } finally {
      setCreatingType(false);
    }
  };

  const handleToggleActive = async (slug: string, active: boolean) => {
    try {
      await api.patch(`/api/financial/entry-types/${slug}`, { active });
      await queryClient.invalidateQueries({ queryKey: ['financial-entry-types'] });
    } catch (e: unknown) {
      const err = e as { response?: { data?: { error?: string } } };
      window.alert(err.response?.data?.error ?? 'Falha ao atualizar tipo.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-5xl max-h-[90vh] rounded-2xl border border-border bg-surface p-6 shadow-glow overflow-hidden flex flex-col">
        <div className="mb-6 flex items-center justify-between gap-4 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-primary" />
            <div>
              <h3 className="text-lg font-semibold">Configuração regras lançamento</h3>
              <p className="text-xs text-muted-foreground">Defina como cada tipo de lançamento deve ser filtrado pelo ciclo.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-surface-hover"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mb-4 rounded-2xl border border-border bg-background/40 p-4">
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
                className="rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-semibold hover:bg-surface-hover transition-colors"
              >
                {showAddType ? 'Cancelar' : '+ Novo tipo'}
              </button>
            </div>

            {showAddType && (
              <div className="mt-3 grid gap-2 rounded-xl border border-border bg-surface p-3 sm:grid-cols-[1fr_2fr_140px_auto] sm:items-end">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">Slug</label>
                  <input
                    value={newSlug}
                    onChange={(e) => setNewSlug(e.target.value.toLowerCase())}
                    placeholder="ex.: bonus_extra"
                    className="w-full rounded-md border border-border bg-background/50 px-3 py-1.5 text-xs font-mono outline-none focus:border-primary/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">Rótulo</label>
                  <input
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="ex.: Bônus extra"
                    className="w-full rounded-md border border-border bg-background/50 px-3 py-1.5 text-xs outline-none focus:border-primary/50"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold uppercase text-muted-foreground">Comportamento</label>
                  <select
                    value={newAffects}
                    onChange={(e) => setNewAffects(e.target.value as 'discount' | 'daily' | 'ignore')}
                    className="w-full rounded-md border border-border bg-background/50 px-3 py-1.5 text-xs outline-none focus:border-primary/50"
                  >
                    <option value="discount">Desconto</option>
                    <option value="ignore">Não impacta</option>
                  </select>
                </div>
                <button
                  type="button"
                  onClick={handleCreateType}
                  disabled={creatingType}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-primary-foreground hover:bg-primary-glow disabled:opacity-50"
                >
                  {creatingType ? 'Criando…' : 'Criar tipo'}
                </button>
                {typeError && <div className="sm:col-span-4 text-[11px] text-destructive">{typeError}</div>}
              </div>
            )}

            <div className="mt-3 flex flex-wrap gap-2">
              {types.map((t) => (
                <span
                  key={t.slug}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[11px]',
                    t.active ? 'border-primary/30 bg-primary/5 text-foreground' : 'border-border bg-background text-muted-foreground line-through'
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
                <div key={type} className="rounded-2xl border border-border bg-background/70 p-4">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="text-sm font-semibold">{label}</div>
                      <div className="text-[10px] text-muted-foreground uppercase">{type}</div>
                    </div>
                    <select
                      value={rule.kind}
                      onChange={(e) => updateRule(type, { kind: e.target.value as DiscountRuleKind })}
                      className="rounded-md border border-border bg-surface px-3 py-2 text-xs outline-none"
                    >
                      {Object.entries(RULE_KIND_LABELS).map(([value, kindLabel]) => (
                        <option key={value} value={value}>{kindLabel}</option>
                      ))}
                    </select>
                  </div>

                  {rule.kind === 'weekly' ? (
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
                            <input
                              type="number"
                              min={0}
                              max={23}
                              value={rule.submissionCutoffHour || 11}
                              onChange={(e) => updateRule(type, { submissionCutoffHour: Number(e.target.value) })}
                              className="w-16 rounded-md border border-border bg-surface px-2 py-1 text-xs outline-none"
                            />
                            <span className="text-xs text-muted-foreground">horas do mesmo dia</span>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : rule.kind === 'monthly' ? (
                    <div className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
                      <label className="text-xs font-semibold uppercase text-muted-foreground">Dia do mês</label>
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={rule.dayOfMonth}
                        onChange={(e) => updateRule(type, { dayOfMonth: Number(e.target.value) || 1 })}
                        className="w-full rounded-md border border-border bg-surface px-3 py-2 text-xs outline-none"
                      />
                    </div>
                  ) : rule.kind === 'monthly_weekday' ? (
                    <div className="space-y-3">
                      <div className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Ocorrência</label>
                        <select
                          value={rule.monthlyNth}
                          onChange={(e) => updateRule(type, { monthlyNth: Number(e.target.value) })}
                          className="rounded-md border border-border bg-surface px-3 py-2 text-xs outline-none"
                        >
                          <option value={1}>1ª</option>
                          <option value={2}>2ª</option>
                          <option value={3}>3ª</option>
                          <option value={4}>4ª</option>
                          <option value={5}>Última</option>
                        </select>
                      </div>
                      <div className="grid gap-2 sm:grid-cols-[180px_1fr] items-center">
                        <label className="text-xs font-semibold uppercase text-muted-foreground">Dia da semana</label>
                        <select
                          value={rule.monthlyWeekday}
                          onChange={(e) => updateRule(type, { monthlyWeekday: Number(e.target.value) })}
                          className="rounded-md border border-border bg-surface px-3 py-2 text-xs outline-none"
                        >
                          {WEEK_DAYS.map(({ value, label }) => (
                            <option key={value} value={value}>{label}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  ) : rule.kind === 'immediate' ? (
                    <div className="rounded-xl border border-border bg-surface p-3 text-[11px] text-muted-foreground">
                      Lançamentos desse tipo são descontados no ciclo em que ocorreram, baseado na data de criação.
                    </div>
                  ) : (
                    <div className="rounded-xl border border-border bg-surface p-3 text-[11px] text-muted-foreground">
                      Pagamentos desse tipo usam a data exata selecionada no filtro.
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-end flex-shrink-0">
          <button
            onClick={onClose}
            className="rounded-md border border-border bg-surface px-4 py-2 text-xs font-medium hover:bg-surface-hover"
          >
            Cancelar
          </button>
          <button
            onClick={handleSave}
            className="rounded-md bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary-glow transition-colors"
          >
            Salvar regras
          </button>
        </div>
      </div>
    </div>
  );
}

function getRuleForType(type: string, rules: Record<string, DiscountRule>) {
  return rules[type] || DEFAULT_DISCOUNT_RULES[type] || { type, kind: 'exact', daysOfWeek: [], dayOfMonth: 1, monthlyNth: 1, monthlyWeekday: 4 };
}

/** UI: 1=Seg … 7=Dom — alinhado a WEEK_DAYS (não usar getDay() direto na regra). */
function uiWeekdayToJsDay(ui: number): number {
  if (ui === 7) return 0;
  return ui;
}

/** n-ésima (1–4) ou última (5) ocorrência do weekday (UI) no mês local de `year`/`monthIndex`. */
function nthWeekdayInMonthLocal(year: number, monthIndex: number, nth: number, weekdayUi: number): Date {
  const targetDow = uiWeekdayToJsDay(weekdayUi);
  if (nth >= 1 && nth <= 4) {
    let count = 0;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(year, monthIndex, d);
      if (dt.getMonth() !== monthIndex) break;
      if (dt.getDay() === targetDow) {
        count++;
        if (count === nth) return dt;
      }
    }
  }
  if (nth === 5) {
    let last: Date | null = null;
    for (let d = 1; d <= 31; d++) {
      const dt = new Date(year, monthIndex, d);
      if (dt.getMonth() !== monthIndex) break;
      if (dt.getDay() === targetDow) last = dt;
    }
    if (last) return last;
  }
  return new Date(year, monthIndex, 1);
}

function summarizeRuleForType(
  type: string,
  rules: Record<string, DiscountRule>,
  labels: Record<string, string>
): string {
  const r = getRuleForType(type, rules);
  const label = labels[type] || type;
  if (type === 'daily') {
    return `Diária: pagamentos Ter/Qui; corte ${r.submissionCutoffHour ?? 11}h (data de início definida na criação).`;
  }
  if (r.kind === 'immediate') return `${label}: desconto no ciclo da criação.`;
  if (r.kind === 'weekly' && r.daysOfWeek.length)
    return `${label}: semanal nos dias ${r.daysOfWeek.join(', ')} (1=Seg … 7=Dom).`;
  if (r.kind === 'monthly_weekday')
    return `${label}: ${r.monthlyNth}ª ocorrência (5=última), dia da semana ${r.monthlyWeekday} (1=Seg … 7=Dom).`;
  return `${label}: ${r.kind}`;
}

function inferEntryOrigin(entry: ApiEntry): string {
  const d = entry.description || '';
  if (/^Desconto de (uniform|bag):/i.test(d)) return 'Automático (insumo entregue)';
  return 'Manual';
}

/** Data local a partir de YYYY-MM-DD (evita deslocamento de parseISO em UTC). */
function parseLocalDateRef(iso: string): Date {
  return parse(iso, 'yyyy-MM-dd', new Date());
}

/** Terça=2 ou quinta=4 no getDay(); demais dias = sem conferência por ciclo. */
function conferenceModeFromRef(iso: string): 'tuesday' | 'thursday' | null {
  const d = parseLocalDateRef(iso);
  if (Number.isNaN(d.getTime())) return null;
  const day = d.getDay();
  if (day === 2) return 'tuesday';
  if (day === 4) return 'thursday';
  return null;
}

/**
 * Terça: só diárias do lote que paga na terça selecionada (corte vindo da regra).
 * Quinta: demais tipos conforme regra + parcela na data selecionada quando aplicável.
 */
function entryMatchesConferenceDay(
  entry: ApiEntry,
  discountRules: Record<string, DiscountRule>,
  selectedCycleStart: string,
  mode: 'tuesday' | 'thursday'
): boolean {
  const installments = entry.financial_installments ?? [];
  const rule = getRuleForType(entry.type, discountRules);
  const cut = rule.submissionCutoffHour ?? 11;
  const refLocal = parseLocalDateRef(selectedCycleStart);

  if (mode === 'tuesday') {
    if (entry.type !== 'daily') return false;
    if (rule.kind !== 'weekly' || rule.daysOfWeek.length === 0) return false;

    const createdAt = parseISO(entry.created_at);
    const createdDay = createdAt.getDay();
    const createdHour = createdAt.getHours();

    let paymentDayOfWeek: number;
    if (createdDay === 4 && createdHour > cut) paymentDayOfWeek = 2;
    else if (createdDay === 2 && createdHour <= cut) paymentDayOfWeek = 2;
    else if (createdDay === 2 && createdHour > cut) paymentDayOfWeek = 4;
    else if (createdDay === 4 && createdHour <= cut) paymentDayOfWeek = 4;
    else if (createdDay === 5 || createdDay === 6 || createdDay === 0 || createdDay === 1) paymentDayOfWeek = 2;
    else if (createdDay === 3) paymentDayOfWeek = 4;
    else paymentDayOfWeek = 4;

    if (paymentDayOfWeek !== 2) return false;

    const weekStart = startOfWeek(refLocal, { weekStartsOn: 1 });
    const paymentDateStr = format(addDays(weekStart, paymentDayOfWeek - 1), 'yyyy-MM-dd');
    if (paymentDateStr !== selectedCycleStart) return false;
    return installments.some((i) => i.due_date === paymentDateStr);
  }

  // Quinta: diárias do lote de quinta + demais tipos conforme regra
  if (rule.kind === 'immediate') {
    const createdDate = format(parseISO(entry.created_at), 'yyyy-MM-dd');
    return createdDate === selectedCycleStart;
  }

  if (rule.kind === 'weekly' && rule.daysOfWeek.length > 0) {
    if (rule.type === 'daily') {
      const createdAt = parseISO(entry.created_at);
      const createdDay = createdAt.getDay();
      const createdHour = createdAt.getHours();
      let paymentDayOfWeek: number;
      if (createdDay === 4 && createdHour > cut) paymentDayOfWeek = 2;
      else if (createdDay === 2 && createdHour <= cut) paymentDayOfWeek = 2;
      else if (createdDay === 2 && createdHour > cut) paymentDayOfWeek = 4;
      else if (createdDay === 4 && createdHour <= cut) paymentDayOfWeek = 4;
      else if (createdDay === 5 || createdDay === 6 || createdDay === 0 || createdDay === 1) paymentDayOfWeek = 2;
      else if (createdDay === 3) paymentDayOfWeek = 4;
      else paymentDayOfWeek = 4;
      if (paymentDayOfWeek !== 4) return false;
      const weekStart = startOfWeek(refLocal, { weekStartsOn: 1 });
      const paymentDateStr = format(addDays(weekStart, paymentDayOfWeek - 1), 'yyyy-MM-dd');
      return paymentDateStr === selectedCycleStart && installments.some((i) => i.due_date === paymentDateStr);
    }

    const weekStart = startOfWeek(refLocal, { weekStartsOn: 1 });
    const targetDates = rule.daysOfWeek.map((dayOfWeek) =>
      format(addDays(weekStart, dayOfWeek - 1), 'yyyy-MM-dd')
    );
    return installments.some(
      (i) => i.due_date === selectedCycleStart && targetDates.includes(i.due_date)
    );
  }

  const targetDate = getFilterDateForRule(rule, selectedCycleStart);
  return installments.some((i) => i.due_date === targetDate);
}

function getFilterDateForRule(rule: DiscountRule, cycleReference: string): string {
  const base = parseLocalDateRef(cycleReference);
  if (Number.isNaN(base.getTime())) return format(new Date(), 'yyyy-MM-dd');

  switch (rule.kind) {
    case 'exact':
      // Para regras exatas, usar o dia do mês especificado
      const exactDate = new Date(base.getFullYear(), base.getMonth(), rule.dayOfMonth);
      return format(exactDate, 'yyyy-MM-dd');

    case 'monthly':
      // Para regras mensais simples, usar o dia do mês
      const monthlyDate = new Date(base.getFullYear(), base.getMonth(), rule.dayOfMonth);
      return format(monthlyDate, 'yyyy-MM-dd');

    case 'monthly_weekday': {
      const y = base.getFullYear();
      const m = base.getMonth();
      const nth = rule.monthlyNth || 1;
      const weekdayUi = rule.monthlyWeekday ?? 4;
      const d = nthWeekdayInMonthLocal(y, m, nth, weekdayUi);
      return format(d, 'yyyy-MM-dd');
    }

    case 'immediate':
      // Para regras imediatas (ex: faltas), sempre retorna a data base
      // A filtragem será feita de forma diferente
      return format(base, 'yyyy-MM-dd');

    case 'weekly':
      // Para regras semanais, usar o primeiro dia da semana configurado
      // (já tratado separadamente no código, mas aqui retorna o primeiro dia como fallback)
      if (rule.daysOfWeek.length > 0) {
        const weekStart = startOfWeek(base, { weekStartsOn: 1 });
        const due = addDays(weekStart, rule.daysOfWeek[0] - 1);
        return format(due, 'yyyy-MM-dd');
      }
      return format(base, 'yyyy-MM-dd');

    default:
      return format(base, 'yyyy-MM-dd');
  }
}

const SP_TZ = 'America/Sao_Paulo';

function formatRequestAtSaoPaulo(iso: string) {
  try {
    return formatDateTimeBr(iso, SP_TZ);
  } catch {
    return format(parseISO(iso), 'dd/MM/yyyy HH:mm');
  }
}

function ApprovalDrawer({
  id,
  fallbackEntry,
  discountRules,
  canApprove,
  onClose,
  onRefresh,
}: {
  id: string;
  fallbackEntry: ApiEntry | null;
  discountRules: Record<string, DiscountRule>;
  canApprove: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const labels = useTypeLabels();
  const { data: entry, isLoading, error } = useQuery<ApiEntry>({
    queryKey: ['financial-entry-detail', id],
    queryFn: () => api.get(`/api/financial/entries/${id}`).then(r => r.data),
    enabled: Boolean(id),
  });
  const activeEntry = entry || fallbackEntry;

  const approveMutation = useMutation({
    mutationFn: () => api.patch(`/api/financial/entries/${id}/approve`),
    onSuccess: () => {
      onRefresh();
      onClose();
    }
  });

  const rejectMutation = useMutation({
    mutationFn: (reason: string) => api.patch(`/api/financial/entries/${id}/reject`, { rejection_reason: reason }),
    onSuccess: () => {
      onRefresh();
      onClose();
    }
  });

  if (isLoading) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-[450px] border-l border-border bg-surface shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Carregando lançamento...</div>
      </div>
    );
  }

  if (error && !fallbackEntry) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-[450px] border-l border-border bg-surface shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-sm text-muted-foreground">
          <div className="rounded-full bg-destructive/10 p-3 text-destructive">Erro ao carregar registro</div>
          <div>{error instanceof Error ? error.message : 'Não foi possível abrir o lançamento.'}</div>
          <button onClick={onClose} className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-surface-hover">Fechar</button>
        </div>
      </div>
    );
  }

  if (!activeEntry) {
    return (
      <div className="fixed inset-y-0 right-0 z-50 w-[450px] border-l border-border bg-surface shadow-2xl animate-in slide-in-from-right duration-300">
        <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-sm text-muted-foreground">
          <div className="rounded-full bg-destructive/10 p-3 text-destructive">Lançamento não disponível</div>
          <div>Não foi possível recuperar os dados do lançamento.</div>
          <button onClick={onClose} className="rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium hover:bg-surface-hover">Fechar</button>
        </div>
      </div>
    );
  }

  const warningMessage = error ? 'Detalhes avançados não puderam ser carregados. Está usando os dados da lista local.' : null;
  const driverName = activeEntry.drivers?.name || 'Sem motorista';
  const driverInitial = driverName.trim().charAt(0) || '?';
  const installments = activeEntry.financial_installments ?? [];

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-[min(100vw,480px)] border-l border-border bg-surface shadow-2xl animate-in slide-in-from-right duration-300">
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border p-4">
          <h3 className="font-semibold tracking-tight">Análise de Lançamento</h3>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-surface-hover"><X className="h-5 w-5" /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold">
              {driverInitial}
            </div>
            <div>
              <div className="font-medium">{driverName}</div>
              <div className="text-[10px] text-muted-foreground font-mono">{activeEntry.drivers?.cpf || '—'}</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 rounded-xl border border-border bg-surface-elevated/50 p-4 text-xs">
            <div className="col-span-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">ID</div>
              <div className="font-mono text-[11px]">{activeEntry.id}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Status</div>
              <div className="font-semibold capitalize">{activeEntry.status.replace(/_/g, ' ')}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Origem</div>
              <div>{inferEntryOrigin(activeEntry)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Tipo</div>
              <div className="text-sm font-bold text-primary">{labels[activeEntry.type] || activeEntry.type}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Valor Total</div>
              <div className="text-sm font-bold font-mono">{formatBRL(Number(activeEntry.total_amount))}</div>
            </div>
            <div className="col-span-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Farmácia</div>
              <div>{activeEntry.pharmacies?.trade_name || '—'}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Solicitado por</div>
              <div>{activeEntry.created_by_user?.name || '—'} ({activeEntry.created_by_user?.role || '—'})</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Abertura (America/Sao_Paulo)</div>
              <div>{formatRequestAtSaoPaulo(activeEntry.created_at)}</div>
            </div>
            <div className="col-span-2">
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Regra de ciclo (somente leitura)</div>
              <div className="text-[11px] leading-snug text-muted-foreground">{summarizeRuleForType(activeEntry.type, discountRules, labels)}</div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Início / frequência</div>
              <div>
                {activeEntry.start_date} · {activeEntry.frequency} · {activeEntry.installments_count}x
              </div>
            </div>
            <div>
              <div className="text-[10px] font-semibold text-muted-foreground uppercase">Auditoria</div>
              <div className="space-y-1">
                {activeEntry.approved_at ? (
                  <div>
                    Aprovado em {formatRequestAtSaoPaulo(activeEntry.approved_at)}
                    {activeEntry.approved_by_user?.name ? ` por ${activeEntry.approved_by_user.name}` : ''}
                  </div>
                ) : (
                  <div>—</div>
                )}
                {activeEntry.rejection_reason ? (
                  <div className="text-destructive">Rejeição: {activeEntry.rejection_reason}</div>
                ) : null}
              </div>
            </div>
          </div>

          {warningMessage ? (
            <div className="rounded-xl border border-warning/20 bg-warning/5 p-3 text-sm text-warning">
              {warningMessage}
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="flex items-center gap-2 text-[10px] font-bold text-muted-foreground uppercase">
              <MessageSquare className="h-3 w-3" /> Justificativa do Líder
            </div>
            <div className="rounded-lg bg-surface-elevated p-3 text-sm italic text-foreground leading-relaxed">
              &ldquo;{activeEntry.description || 'Sem justificativa preenchida.'}&rdquo;
            </div>
          </div>

          <div className="space-y-2">
            <div className="text-[10px] font-bold text-muted-foreground uppercase">Parcelas</div>
            {installments.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface-elevated p-3 text-xs text-muted-foreground">
                Nenhuma parcela cadastrada para este lançamento.
              </div>
            ) : (
              <div className="max-h-48 overflow-y-auto rounded-lg border border-border">
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-surface-elevated text-[10px] uppercase text-muted-foreground">
                    <tr>
                      <th className="px-2 py-1.5">#</th>
                      <th className="px-2 py-1.5">Venc.</th>
                      <th className="px-2 py-1.5 text-right">Valor</th>
                      <th className="px-2 py-1.5">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {installments.map((row) => (
                      <tr key={row.id}>
                        <td className="px-2 py-1 font-mono">{row.installment_number}</td>
                        <td className="px-2 py-1">{format(parseISO(row.due_date), 'dd/MM/yyyy')}</td>
                        <td className="px-2 py-1 text-right font-mono">{formatBRL(Number(row.amount))}</td>
                        <td className="px-2 py-1 capitalize">{row.status}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {activeEntry.type === 'daily' && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 flex items-start gap-3">
              <Info className="h-4 w-4 text-primary shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-bold text-primary">Regra de Pagamento de Diária</div>
                <p className="text-[11px] text-primary/80 mt-1">
                  Este lançamento será liquidado na <span className="font-bold underline">{format(parseISO(activeEntry.start_date), "EEEE, dd/MM", { locale: ptBR })}</span>.
                </p>
              </div>
            </div>
          )}
        </div>

        {canApprove && activeEntry.status === 'pending_approval' ? (
          <div className="p-4 border-t border-border flex gap-3 bg-surface-elevated/50">
            <button
              type="button"
              onClick={() => {
                const reason = window.prompt('Motivo da rejeição:');
                if (reason) rejectMutation.mutate(reason);
              }}
              disabled={rejectMutation.isPending}
              className="flex-1 rounded-md border border-border bg-surface py-2 text-xs font-medium text-destructive hover:bg-destructive/5 transition-colors"
            >
              Rejeitar
            </button>
            <button
              type="button"
              onClick={() => approveMutation.mutate()}
              disabled={approveMutation.isPending}
              className="flex-1 rounded-md bg-primary py-2 text-xs font-bold text-primary-foreground hover:bg-primary-glow shadow-glow transition-all"
            >
              {approveMutation.isPending ? 'Processando...' : 'Aprovar Pagamento'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function NewEntryModal({ 
  onClose, 
  onCreated,
  approvalMode,
}: { 
  onClose: () => void; 
  onCreated: () => void;
  approvalMode?: {
    enabled: boolean;
    taskId: string;
    driverId: string;
    startDate: string;
  };
}) {
  const labels = useTypeLabels();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    driver_id: approvalMode?.enabled ? approvalMode.driverId : '',
    type: approvalMode?.enabled ? 'advance' : 'quota',
    total_amount: '',
    installments_count: '1',
    frequency: 'weekly',
    start_date: approvalMode?.enabled ? approvalMode.startDate : format(new Date(), 'yyyy-MM-dd'),
    description: '',
    notes: '',
  });

  const { data: drivers, isLoading: loadingDrivers, error: driversError } = useQuery<{ id: string; name: string; cpf: string }[]>({
    queryKey: ['drivers-active-list'],
    queryFn: () => api.get('/api/drivers', { params: { status: 'active' } }).then((r) => r.data),
  });

  if (driversError) {
    console.error('Falha ao carregar entregadores:', driversError);
  }

  const installmentValue = useMemo(() => {
    const total = parseFloat(form.total_amount) || 0;
    const count = parseInt(form.installments_count) || 1;
    return total / count;
  }, [form.total_amount, form.installments_count]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await api.post('/api/financial/entries', {
        ...form,
        total_amount: parseFloat(form.total_amount),
        installments_count: parseInt(form.installments_count),
      }, {
        headers: approvalMode?.enabled ? { 'x-from-task': approvalMode.taskId } : undefined,
      });
      onCreated();
      onClose();
    } catch (e: unknown) {
      const error = e as { response?: { data?: { error?: string } } };
      setError(error.response?.data?.error || 'Erro ao criar lançamento');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6 shadow-glow animate-in fade-in zoom-in duration-200">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold tracking-tight">Novo lançamento</h3>
            <p className="text-xs text-muted-foreground">Configure as cotas ou descontos do entregador.</p>
          </div>
          <button onClick={onClose} className="rounded-full p-1 text-muted-foreground hover:bg-surface-hover hover:text-foreground transition-colors">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4">
          {approvalMode?.enabled ? (
            <div className="rounded-lg border border-primary/20 bg-primary/10 p-3 text-xs text-primary">
              Modo aprovação de adiantamento: somente Valor total, Nº parcelas e Descrição/Justificativa podem ser alterados.
            </div>
          ) : null}

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Entregador</label>
            <select
              value={form.driver_id}
              onChange={(e) => setForm(f => ({ ...f, driver_id: e.target.value }))}
              disabled={approvalMode?.enabled}
              className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors"
            >
              <option value="">{loadingDrivers ? 'Carregando...' : 'Selecione o entregador...'}</option>
              {(drivers || []).map(d => (
                <option key={d.id} value={d.id}>{d.name} ({d.cpf})</option>
              ))}
            </select>
            {driversError && <p className="text-[10px] text-destructive">Erro ao carregar lista de entregadores.</p>}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Tipo</label>
              <select
                value={form.type}
                onChange={(e) => setForm(f => ({ ...f, type: e.target.value }))}
                disabled={approvalMode?.enabled}
                className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors"
              >
                {Object.entries(labels).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Frequência</label>
              <select
                value={form.frequency}
                onChange={(e) => setForm(f => ({ ...f, frequency: e.target.value }))}
                disabled={approvalMode?.enabled}
                className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors"
              >
                <option value="weekly">Semanal (Pagamento Quinta)</option>
                <option value="monthly">Mensal</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Valor Total</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-mono text-muted-foreground">R$</span>
                <input
                  type="number"
                  value={form.total_amount}
                  onChange={(e) => setForm(f => ({ ...f, total_amount: e.target.value }))}
                  placeholder="0,00"
                  className="w-full rounded-md border border-border bg-background/50 py-2 pl-9 pr-3 text-sm font-mono outline-none focus:border-primary/50 transition-colors"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Nº Parcelas</label>
              <input
                type="number"
                min="1"
                value={form.installments_count}
                onChange={(e) => setForm(f => ({ ...f, installments_count: e.target.value }))}
                className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm font-mono outline-none focus:border-primary/50 transition-colors"
              />
            </div>
          </div>

          <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-center">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-primary">Valor da parcela estimada</span>
            <div className="text-xl font-bold text-primary">{formatBRL(installmentValue)}</div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Data Base do Ciclo</label>
            <input
              type="date"
              lang="pt-BR"
              value={form.start_date}
              onChange={(e) => setForm(f => ({ ...f, start_date: e.target.value }))}
              disabled={approvalMode?.enabled}
              className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors"
            />
            <div className="text-xs text-muted-foreground">{formatDateBr(form.start_date)}</div>
          </div>

          <div className="space-y-1.5">
            <label className="text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">Descrição / Justificativa</label>
            <input
              type="text"
              value={form.description}
              onChange={(e) => setForm(f => ({ ...f, description: e.target.value }))}
              placeholder="Ex: Pagamento referente a rota extra..."
              className="w-full rounded-md border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-primary/50 transition-colors"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex gap-3 pt-2">
            <button
              onClick={onClose}
              className="flex-1 rounded-md border border-border bg-surface py-2 text-sm font-medium hover:bg-surface-hover transition-colors"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !form.driver_id || !form.total_amount}
              className="flex-1 rounded-md bg-primary py-2 text-sm font-semibold text-primary-foreground hover:bg-primary-glow shadow-glow disabled:opacity-50 transition-all"
            >
              {saving ? 'Criando...' : 'Confirmar Lançamento'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function FinanceiroPage() {
  const user = useAuth((s) => s.user);
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [showNew, setShowNew] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<ApiEntry | null>(null);
  const advanceApprovalMode = useMemo(() => {
    const fromTask = (searchParams.get('fromTask') || '').trim();
    const driverId = (searchParams.get('driver_id') || '').trim();
    const type = (searchParams.get('type') || '').trim();
    const decision = (searchParams.get('decision') || '').trim();
    const approvedAt = (searchParams.get('approved_at') || '').trim();
    const enabled = Boolean(fromTask && driverId && type === 'advance' && decision === 'approved');
    const startDate = ((approvedAt ? new Date(approvedAt) : new Date()).toISOString().slice(0, 10));
    return {
      enabled,
      taskId: fromTask,
      driverId,
      startDate,
    };
  }, [searchParams]);

  useEffect(() => {
    if (advanceApprovalMode.enabled) setShowNew(true);
  }, [advanceApprovalMode.enabled]);
  const [discountRules, setDiscountRules] = useState<Record<string, DiscountRule>>(() => {
    if (typeof window === 'undefined') return DEFAULT_DISCOUNT_RULES;
    try {
      const saved = window.localStorage.getItem('financial-discount-rules');
      return saved ? { ...DEFAULT_DISCOUNT_RULES, ...JSON.parse(saved) } : DEFAULT_DISCOUNT_RULES;
    } catch {
      return DEFAULT_DISCOUNT_RULES;
    }
  });

  const { data: discountRulesPayload } = useQuery({
    queryKey: ['financial-discount-rules'],
    queryFn: () => api.get('/api/financial/discount-rules').then((r) => r.data as { rules: Record<string, DiscountRule> }),
    retry: 1,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (discountRulesPayload?.rules && typeof discountRulesPayload.rules === 'object') {
      setDiscountRules({ ...DEFAULT_DISCOUNT_RULES, ...discountRulesPayload.rules });
    }
  }, [discountRulesPayload]);

  const { data: entryTypesPayload } = useQuery({
    queryKey: ['financial-entry-types'],
    queryFn: () => api.get('/api/financial/entry-types').then((r) => r.data as { types: FinancialEntryTypeMeta[] }),
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const entryTypesCtx = useMemo<EntryTypesCtx>(() => {
    const list = entryTypesPayload?.types ?? [];
    return { types: list, labels: buildTypeLabels(list) };
  }, [entryTypesPayload]);

  const saveDiscountRules = async (rules: Record<string, DiscountRule>) => {
    try {
      await api.put('/api/financial/discount-rules', { rules });
      setDiscountRules(rules);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem('financial-discount-rules', JSON.stringify(rules));
      }
      void queryClient.invalidateQueries({ queryKey: ['financial-discount-rules'] });
    } catch {
      window.alert('Não foi possível salvar as regras no servidor. Verifique permissões (admin/financeiro).');
    }
  };

  /** Ancora semana/mês usado nos KPIs de ciclo (regras por tipo). */
  const currentCycleStart = useMemo(() => format(new Date(), 'yyyy-MM-dd'), []);
  const [selectedCycleStart, setSelectedCycleStart] = useState<string>(currentCycleStart);

  const { data: entriesData, isLoading, refetch, isFetching } = useQuery<ApiEntry[]>({
    queryKey: ['financial-entries', statusFilter, typeFilter],
    queryFn: () => {
      let url = `/api/financial/entries?`;
      if (statusFilter !== 'all') url += `status=${statusFilter}&`;
      if (typeFilter !== 'all') url += `type=${typeFilter}&`;
      return api.get(url).then((r) => r.data);
    },
  });

  const entries = useMemo(() => entriesData || [], [entriesData]);

  const conferenceMode = useMemo(
    () => conferenceModeFromRef(selectedCycleStart),
    [selectedCycleStart]
  );

  const finalFiltered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const bySearch = (list: ApiEntry[]) =>
      !needle
        ? list
        : list.filter((entry) =>
            `${entry.drivers?.name ?? ''} ${entry.drivers?.cpf ?? ''} ${entry.description ?? ''}`
              .toLowerCase()
              .includes(needle)
          );

    if (conferenceMode === null) return bySearch(entries);

    return bySearch(entries).filter((entry) =>
      entryMatchesConferenceDay(entry, discountRules, selectedCycleStart, conferenceMode)
    );
  }, [entries, search, selectedCycleStart, discountRules, conferenceMode]);

  const stats = useMemo(() => {
    let cycleDiscounts = 0;
    let cycleDailies = 0;
    let pendingApproval = 0;

    for (const entry of entries) {
      if (entry.status === 'pending_approval') pendingApproval++;
    }

    if (conferenceMode === null) {
      return { cycleDiscounts: 0, cycleDailies: 0, pendingApproval };
    }

    for (const entry of entries) {
      if (!entryMatchesConferenceDay(entry, discountRules, selectedCycleStart, conferenceMode)) continue;

      const instList = entry.financial_installments ?? [];
      const rule = getRuleForType(entry.type, discountRules);

      if (rule.kind === 'weekly' && rule.daysOfWeek.length > 0) {
        const weekStart = startOfWeek(parseLocalDateRef(selectedCycleStart), { weekStartsOn: 1 });
        const targetDates = rule.daysOfWeek.map((dayOfWeek) =>
          format(addDays(weekStart, dayOfWeek - 1), 'yyyy-MM-dd')
        );

        for (const inst of instList) {
          if (targetDates.includes(inst.due_date)) {
            if (entry.type === 'daily') cycleDailies += Number(inst.amount);
            else cycleDiscounts += Number(inst.amount);
          }
        }
      } else {
        const targetDate = getFilterDateForRule(rule, selectedCycleStart);
        for (const inst of instList) {
          if (inst.due_date === targetDate) {
            if (entry.type === 'daily') cycleDailies += Number(inst.amount);
            else cycleDiscounts += Number(inst.amount);
          }
        }
      }
    }

    return { cycleDiscounts, cycleDailies, pendingApproval };
  }, [entries, selectedCycleStart, discountRules, conferenceMode]);

  return (
    <EntryTypesContext.Provider value={entryTypesCtx}>
    <div className="h-full overflow-y-auto bg-background">
      <div className="mx-auto max-w-7xl px-8 py-8">
        <PageHeader
          eyebrow="Financeiro"
          title="Gestão de Ciclos e Descontos"
          description="Acompanhe faturamento, cotas e pagamentos semanais."
          actions={
            <>
              <button 
                onClick={() => setShowImport(true)} 
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-success" /> Importar Faturamento
              </button>
              <button 
                onClick={() => setShowRules(true)} 
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" /> Configuração regras lançamento
              </button>
              <button 
                onClick={() => void refetch()} 
                disabled={isFetching} 
                className="flex items-center gap-1.5 rounded-md border border-border bg-surface px-3 py-1.5 text-xs font-medium hover:bg-surface-hover transition-colors"
              >
                <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} /> Atualizar
              </button>
              <button 
                onClick={() => setShowNew(true)} 
                className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary-glow shadow-glow transition-all"
              >
                <Plus className="h-3.5 w-3.5" /> Novo lançamento
              </button>
            </>
          }
        />

        {/* KPIs */}
        <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><Wallet className="h-4 w-4" /></div>
              <span className="text-[9px] font-bold text-muted-foreground uppercase">Ciclo Atual</span>
            </div>
            <div className="mt-4 text-2xl font-semibold tracking-tight">{formatBRL(stats.cycleDailies)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Diárias (Ter/Qui)</div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-destructive/10 text-destructive"><TrendingDown className="h-4 w-4" /></div>
            </div>
            <div className="mt-4 text-2xl font-semibold tracking-tight text-destructive">{formatBRL(stats.cycleDiscounts)}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Descontos da Semana</div>
          </div>
          <div
            onClick={() =>
              setStatusFilter((s) => (s === 'pending_approval' ? 'all' : 'pending_approval'))
            }
            className="cursor-pointer rounded-xl border border-border bg-surface p-5 shadow-sm border-l-4 border-l-warning hover:bg-surface-hover/50 transition-colors"
          >
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-warning/10 text-warning"><Clock className="h-4 w-4" /></div>
              <span className="text-[9px] font-bold text-warning uppercase">Aprovação</span>
            </div>
            <div className="mt-4 text-2xl font-bold tracking-tight text-warning">{stats.pendingApproval}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Lançamentos aguardando</div>
          </div>
          <div className="rounded-xl border border-border bg-surface p-5 shadow-sm border-l-4 border-l-success">
            <div className="flex items-center justify-between">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-success/10 text-success"><DollarSign className="h-4 w-4" /></div>
            </div>
            <div className="mt-4 text-2xl font-semibold tracking-tight text-success">{formatBRL(Math.max(0, stats.cycleDailies - stats.cycleDiscounts))}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">Líquido Estimado</div>
          </div>
        </div>

        {conferenceMode === null ? (
          <div className="mb-4 flex gap-3 rounded-lg border border-warning/30 bg-warning/5 px-4 py-3 text-sm">
            <AlertCircle className="h-5 w-5 shrink-0 text-warning" />
            <div>
              <p className="font-medium text-foreground">Selecione uma terça-feira ou quinta-feira</p>
              <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                A conferência por ciclo de pagamento só se aplica quando a <strong>data de referência</strong> é{' '}
                <strong>terça</strong> (diárias do lote que paga na terça, respeitando o horário de corte das regras) ou{' '}
                <strong>quinta</strong> (diárias do lote de quinta, faltas, cotas, certificado digital e demais tipos conforme cada regra).
                Com outro dia da semana, <strong>não há filtro de ciclo na tabela</strong> — aparecem todos os lançamentos (ainda filtrados por tipo, Pendentes e busca). Os totais de &quot;Ciclo atual&quot; e &quot;Descontos da semana&quot; ficam em zero até você ajustar a data.
              </p>
            </div>
          </div>
        ) : (
          <p className="mb-3 text-xs text-muted-foreground">
            {conferenceMode === 'tuesday' ? (
              <>
                <span className="font-semibold text-foreground">Conferência terça:</span> diárias do lote de pagamento nesta terça (corte até{' '}
                {discountRules.daily?.submissionCutoffHour ?? 11}h na configuração de regras).
              </>
            ) : (
              <>
                <span className="font-semibold text-foreground">Conferência quinta:</span> lançamentos do lote de quinta e demais tipos conforme regra (parcela ou data de criação, conforme o tipo).
              </>
            )}
          </p>
        )}

        {/* Filtros: data de referência (KPIs), tipo, pendentes; busca opcional */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1">
            <Calendar className="h-3 w-3 text-muted-foreground" />
            <span className="text-[10px] font-semibold text-muted-foreground uppercase">Data de referência</span>
            <input type="date" lang="pt-BR" value={selectedCycleStart} onChange={(e) => setSelectedCycleStart(e.target.value)} className="bg-transparent border-none text-xs font-mono outline-none text-foreground cursor-pointer" />
            <span className="text-xs text-muted-foreground">{formatDateBr(selectedCycleStart)}</span>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-border bg-surface p-0.5">
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="bg-transparent border-none text-[11px] font-medium px-2 py-1 outline-none text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <option value="all">Todos os Tipos</option>
              {Object.entries(entryTypesCtx.labels).map(([val, label]) => <option key={val} value={val}>{label}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() =>
              setStatusFilter((prev) => (prev === 'pending_approval' ? 'all' : 'pending_approval'))
            }
            className={cn(
              'rounded-md border px-3 py-1 text-xs font-medium transition-colors',
              statusFilter === 'pending_approval'
                ? 'border-warning bg-warning/10 text-warning'
                : 'border-border bg-surface text-muted-foreground hover:bg-surface-hover'
            )}
          >
            Pendentes
          </button>
          <div className="relative min-w-[180px] max-w-sm flex-1">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar entregador ou justificativa…"
              className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-xs outline-none focus:border-primary/50 transition-colors"
            />
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-surface shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-border bg-surface-elevated/50 text-left text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">
                  <th className="px-4 py-3">ID / Tipo</th>
                  <th className="px-4 py-3">Entregador</th>
                  <th className="px-4 py-3">Farmácia</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3">Parcelas</th>
                  <th className="px-4 py-3">Próx. Vencimento</th>
                  <th className="px-4 py-3">Progresso</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {isLoading ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">Sincronizando banco...</td></tr>
                ) : finalFiltered.length === 0 ? (
                  <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">Nenhum registro encontrado.</td></tr>
                ) : (
                  finalFiltered.map(e => {
                    const meta = statusMeta[e.status] || statusMeta.draft;
                    const Icon = meta.icon;
                    const instRows = e.financial_installments ?? [];
                    const pendingInst = instRows.filter((i) => i.status === 'pending').sort((a, b) => a.due_date.localeCompare(b.due_date));
                    const dueDate = pendingInst[0]?.due_date ?? instRows[0]?.due_date ?? e.start_date;

                    const totalInstallments = instRows.length;
                    const paidInstallments = instRows.filter(i => i.status === 'paid').length;
                    const progressPercent = totalInstallments ? Math.round((paidInstallments / totalInstallments) * 100) : 0;

                    return (
                      <tr key={e.id} onClick={() => { setSelectedId(e.id); setSelectedEntry(e); }} className="group cursor-pointer hover:bg-surface-hover/50 transition-colors">
                        <td className="px-4 py-3">
                          <div className="flex flex-col">
                            <span className="font-mono text-[10px] text-muted-foreground">#{e.id.slice(0, 6).toUpperCase()}</span>
                            <span className="text-[11px] font-bold text-primary uppercase">{entryTypesCtx.labels[e.type] || e.type}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-sm font-medium">{e.drivers?.name || '—'}</div>
                          <div className="text-[10px] text-muted-foreground font-mono">{e.drivers?.cpf || '—'}</div>
                        </td>
                        <td className="px-4 py-3 text-sm text-foreground">
                          {e.pharmacies?.trade_name || 'Sem farmácia'}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-sm font-semibold">{formatBRL(Number(e.total_amount))}</td>
                        <td className="px-4 py-3 text-sm font-medium">
                          {paidInstallments}/{totalInstallments}
                        </td>
                        <td className="px-4 py-3">
                          <div className="text-xs font-medium text-muted-foreground">
                            {format(parse(dueDate, 'yyyy-MM-dd', new Date()), 'dd/MM/yyyy')}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
                              <span>{progressPercent}%</span>
                              <span className="text-[10px] font-semibold">{paidInstallments}/{totalInstallments}</span>
                            </div>
                            <div className="h-2 w-full overflow-hidden rounded-full bg-background/60">
                              <div className="h-full rounded-full bg-success transition-all" style={{ width: `${progressPercent}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold border uppercase", meta.color, "border-current/10")}><Icon className="h-2.5 w-2.5" /> {meta.label}</span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <ChevronRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-all" />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      {showNew && (
        <NewEntryModal
          onClose={() => {
            setShowNew(false);
            if (advanceApprovalMode.enabled) router.replace('/financial');
          }}
          onCreated={() => {
            void refetch();
            if (advanceApprovalMode.enabled) router.replace('/financial');
          }}
          approvalMode={advanceApprovalMode}
        />
      )}
      {showImport && <ImportBillingModal onClose={() => setShowImport(false)} onImported={() => void refetch()} />}
      {showRules && <DiscountRulesModal rules={discountRules} onClose={() => setShowRules(false)} onSave={(r) => void saveDiscountRules(r)} />}
      {selectedId && (
        <ApprovalDrawer
          id={selectedId}
          fallbackEntry={selectedEntry}
          discountRules={discountRules}
          canApprove={['admin', 'supervisor'].includes(user?.role || '')}
          onClose={() => {
            setSelectedId(null);
            setSelectedEntry(null);
          }}
          onRefresh={() => void refetch()}
        />
      )}
    </div>
    </EntryTypesContext.Provider>
  );
}

import { CheckCircle2, Clock, AlertCircle, Info } from 'lucide-react';
import { listConferencePaymentWeekdays, type DiscountRule } from '@/lib/financialCycle';
import type { ApiEntry, FinancialEntryTypeMeta } from '@/lib/financial/types';

export const DEFAULT_TYPE_LABELS: Record<string, string> = {
  quota: 'Cota',
  bag: 'Bag',
  uniform: 'Camiseta/Uniforme',
  digital_cert: 'Certificado digital',
  advance: 'Adiantamento',
  absence: 'Falta',
  daily: 'Diária',
  other: 'Outro',
};

export function buildTypeLabels(types: FinancialEntryTypeMeta[] | undefined): Record<string, string> {
  if (!types || types.length === 0) return DEFAULT_TYPE_LABELS;
  const out: Record<string, string> = { ...DEFAULT_TYPE_LABELS };
  for (const t of types) {
    if (t.active) out[t.slug] = t.label;
  }
  return out;
}
export const statusMeta: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  active: { label: "Ativo", color: "bg-primary/15 text-primary", icon: Clock },
  settled: { label: "Quitado", color: "bg-success/15 text-success", icon: CheckCircle2 },
  overdue: { label: "Vencido", color: "bg-destructive/15 text-destructive", icon: AlertCircle },
  pending_approval: { label: "Aguard. aprovação", color: "bg-warning/15 text-warning", icon: Clock },
  rejected: { label: "Rejeitado", color: "bg-destructive/15 text-destructive", icon: AlertCircle },
  informed: { label: "Informativo", color: "bg-muted text-muted-foreground", icon: Info },
  approved: { label: "Aprovado", color: "bg-success/15 text-success", icon: CheckCircle2 },
  draft: { label: "Rascunho", color: "bg-muted text-muted-foreground", icon: Clock },
  cancelled: { label: "Cancelado", color: "bg-muted text-muted-foreground", icon: CheckCircle2 },
  partially_cancelled: { label: "Parc. cancelado", color: "bg-warning/15 text-warning", icon: AlertCircle },
};

export function entryStatusLabel(status: string): string {
  const map: Record<string, string> = {
    active: 'Ativo',
    settled: 'Quitado',
    overdue: 'Vencido',
    pending_approval: 'Aguardando aprovação',
    rejected: 'Rejeitado',
    informed: 'Informativo',
    approved: 'Aprovado',
    draft: 'Rascunho',
    cancelled: 'Cancelado',
    partially_cancelled: 'Parcialmente cancelado',
  };
  return map[status] || status;
}

export function frequencyLabel(freq: string): string {
  if (freq === 'weekly') return 'Semanal';
  if (freq === 'monthly') return 'Mensal';
  return freq;
}

export function userRoleLabel(role?: string | null): string {
  if (!role) return '—';
  const map: Record<string, string> = {
    admin: 'Administrador',
    financial: 'Financeiro',
    supervisor: 'Supervisor',
    leader: 'Líder',
    operational: 'Operacional',
  };
  return map[role] || role;
}

export function absenceDispositionLabel(disposition?: string | null): string | null {
  if (!disposition || disposition === 'pending') return 'Aguardando decisão';
  if (disposition === 'excused') return 'Abonada';
  if (disposition === 'discounted') return 'Desconto aplicado';
  return null;
}
export function coverageRoleLabel(kind?: string | null): string {
  if (kind === 'day_off') return 'folguista';
  if (kind === 'unexcused') return 'diarista';
  return 'cobridor';
}

export function occurrenceKindLabel(kind?: string | null): string | null {
  if (kind === 'day_off') return 'Folga';
  if (kind === 'unexcused') return 'Falta';
  if (kind === 'contracted_daily') return 'Diária contratada (trabalhou)';
  return null;
}

export function inferEntryOrigin(entry: ApiEntry): string {
  if (entry.occurrence_kind === 'day_off') return 'Ocorrência de escala (folga)';
  if (entry.occurrence_kind === 'unexcused') return 'Ocorrência de escala (falta)';
  if (entry.occurrence_kind === 'contracted_daily') return 'Ocorrência de escala (diária contratada)';
  if (entry.coverage_of_entry_id) return 'Ocorrência de escala (cobertura)';
  const d = entry.description || '';
  if (/^Desconto de (uniform|bag):/i.test(d)) return 'Automático (insumo entregue)';
  return 'Manual';
}
export const WEEK_DAY_LABELS: Record<number, string> = {
  1: 'Segunda',
  2: 'Terça',
  3: 'Quarta',
  4: 'Quinta',
  5: 'Sexta',
  6: 'Sábado',
  7: 'Domingo',
};

export function conferenceDayLabels(rules: Record<string, DiscountRule>): string {
  return listConferencePaymentWeekdays(rules)
    .map((d) => WEEK_DAY_LABELS[d] || String(d))
    .join(', ');
}

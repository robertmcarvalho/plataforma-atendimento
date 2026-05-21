'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, Check, Clock } from 'lucide-react';
import { cn } from '@/lib/utils';

export type AttendanceSlaStageDetail = {
  status?: string | null;
  opened_at?: string | null;
  resolved_at?: string | null;
  sla_first_response_deadline?: string | null;
  sla_first_response_at?: string | null;
  sla_first_response_ok?: boolean | null;
  sla_treatment_deadline?: string | null;
  sla_resolution_deadline?: string | null;
  sla_resolved_ok?: boolean | null;
};

function parseMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const n = new Date(iso).getTime();
  return Number.isFinite(n) ? n : null;
}

/** Prazo persistido ou interpolado (conversas antigas só com 1ª + resolução). */
export function deriveTreatmentDeadlineIso(d: AttendanceSlaStageDetail): string | null {
  if (d.sla_treatment_deadline) return d.sla_treatment_deadline;
  const f = parseMs(d.sla_first_response_deadline);
  const r = parseMs(d.sla_resolution_deadline);
  if (f === null || r === null || !(r > f)) return null;
  return new Date(f + Math.floor((r - f) / 2)).toISOString();
}

function distinctTreatment(firstDl: string | null | undefined, treatmentDl: string | null | undefined, resolutionDl: string | null | undefined) {
  const f = parseMs(firstDl);
  const t = parseMs(treatmentDl);
  const r = parseMs(resolutionDl);
  if (f === null || t === null || r === null) return false;
  return t > f && r > t;
}

export function isSlaConversationTerminal(d: AttendanceSlaStageDetail): boolean {
  const s = String(d.status || '').toLowerCase();
  if (s === 'resolved' || s === 'closed') return true;
  return Boolean(d.resolved_at);
}

function clampPct(n: number) {
  return Math.max(0, Math.min(100, n));
}

function linearProgress(nowMs: number, startMs: number, endMs: number): number {
  if (endMs <= startMs) return 100;
  return clampPct(((nowMs - startMs) / (endMs - startMs)) * 100);
}

type RowTone = 'neutral' | 'ok' | 'warn' | 'bad';

function toneBarClass(tone: RowTone) {
  if (tone === 'ok') return 'bg-emerald-500';
  if (tone === 'bad') return 'bg-destructive';
  if (tone === 'warn') return 'bg-amber-500';
  return 'bg-primary';
}

/** Prazo exibido no chip “SLA · mm:ss” conforme a etapa em curso. */
export function pickActiveSlaDeadlineForCountdown(d: AttendanceSlaStageDetail | null | undefined, nowMs: number): string | null {
  if (!d || isSlaConversationTerminal(d)) return null;

  const firstDl = d.sla_first_response_deadline;
  const treatmentDl = deriveTreatmentDeadlineIso(d);
  const resolutionDl = d.sla_resolution_deadline;
  const firstAt = d.sla_first_response_at;
  const hasMid = distinctTreatment(firstDl, treatmentDl, resolutionDl);

  if (firstDl && !firstAt) return firstDl;

  const tEnd = parseMs(treatmentDl);
  if (firstAt && hasMid && tEnd !== null && nowMs < tEnd) return treatmentDl;

  return resolutionDl || null;
}

type StageKey = 'first' | 'treatment' | 'resolution';

type Row = {
  key: StageKey;
  title: string;
  pct: number;
  tone: RowTone;
  deadlineLabel: string;
  badge: 'wait' | 'focus' | 'ok' | 'bad';
  icon: 'clock' | 'check' | 'alert';
};

export function InboxAttendanceSlaStages({
  detail,
  nowMs,
}: {
  detail: AttendanceSlaStageDetail | null | undefined;
  nowMs: number;
}) {
  if (!detail) return null;

  const terminal = isSlaConversationTerminal(detail);
  const openedMs = parseMs(detail.opened_at) ?? nowMs;
  const firstDl = detail.sla_first_response_deadline;
  const treatmentDl = deriveTreatmentDeadlineIso(detail);
  const resolutionDl = detail.sla_resolution_deadline;

  const firstMs = parseMs(firstDl);
  const treatmentMs = parseMs(treatmentDl);
  const resolutionMs = parseMs(resolutionDl);
  const firstAtMs = parseMs(detail.sla_first_response_at);
  const resolvedMs = parseMs(detail.resolved_at);

  const hasMid = distinctTreatment(firstDl, treatmentDl, resolutionDl);

  if (firstMs === null && resolutionMs === null) {
    return <p className="text-xs text-muted-foreground">Sem SLA configurado nesta conversa.</p>;
  }

  const unlockedTreatment = Boolean(firstAtMs) && hasMid;
  const unlockedResolution = Boolean(firstAtMs) && (!hasMid || (treatmentMs !== null && (terminal || nowMs >= treatmentMs)));

  let focus: StageKey | null = null;
  if (!terminal) {
    if (!firstAtMs && firstMs !== null) focus = 'first';
    else if (unlockedTreatment && treatmentMs !== null && nowMs < treatmentMs) focus = 'treatment';
    else if (unlockedResolution && resolutionMs !== null) focus = 'resolution';
  }

  const rows: Row[] = [];

  if (firstMs !== null) {
    let pct: number;
    let tone: RowTone = 'neutral';
    let badge: Row['badge'] = 'wait';
    let icon: Row['icon'] = 'clock';

    if (!firstAtMs) {
      pct = linearProgress(nowMs, openedMs, firstMs);
      if (nowMs > firstMs) {
        tone = 'bad';
        badge = 'bad';
        icon = 'alert';
      } else if (firstMs - nowMs <= 10 * 60 * 1000) {
        tone = 'warn';
        badge = focus === 'first' ? 'focus' : 'wait';
      } else {
        badge = focus === 'first' ? 'focus' : 'wait';
      }
    } else {
      pct = clampPct(linearProgress(firstAtMs, openedMs, firstMs));
      const ok = detail.sla_first_response_ok !== false && firstAtMs <= firstMs;
      if (!ok || firstAtMs > firstMs) {
        tone = 'bad';
        badge = 'bad';
        icon = 'alert';
      } else {
        tone = 'ok';
        badge = 'ok';
        icon = 'check';
      }
    }

    rows.push({
      key: 'first',
      title: '1ª resposta',
      pct,
      tone,
      deadlineLabel: format(new Date(firstMs), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }),
      badge,
      icon,
    });
  }

  if (hasMid && treatmentMs !== null && (unlockedTreatment || terminal)) {
    let pct = 0;
    let tone: RowTone = 'neutral';
    let badge: Row['badge'] = 'wait';
    let icon: Row['icon'] = 'clock';

    const start = Math.max(openedMs, firstAtMs ?? openedMs);

    if (terminal && resolvedMs !== null) {
      const okTreat = resolvedMs <= treatmentMs;
      pct = 100;
      tone = okTreat ? 'ok' : 'bad';
      badge = okTreat ? 'ok' : 'bad';
      icon = okTreat ? 'check' : 'alert';
    } else if (!terminal) {
      pct = linearProgress(nowMs, start, treatmentMs);
      if (nowMs > treatmentMs) {
        tone = 'bad';
        badge = 'bad';
        icon = 'alert';
      } else if (treatmentMs - nowMs <= 10 * 60 * 1000) {
        tone = 'warn';
        badge = focus === 'treatment' ? 'focus' : 'wait';
      } else {
        badge = focus === 'treatment' ? 'focus' : 'wait';
      }
    }

    rows.push({
      key: 'treatment',
      title: 'Tratamento',
      pct,
      tone,
      deadlineLabel: format(new Date(treatmentMs), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }),
      badge,
      icon,
    });
  }

  if (resolutionMs !== null && (unlockedResolution || terminal)) {
    const start =
      hasMid && treatmentMs !== null ? Math.max(openedMs, treatmentMs) : Math.max(openedMs, firstAtMs ?? openedMs);

    let pct = 0;
    let tone: RowTone = 'neutral';
    let badge: Row['badge'] = 'wait';
    let icon: Row['icon'] = 'clock';

    if (terminal && resolvedMs !== null) {
      const rok = detail.sla_resolved_ok !== false;
      const okRes = resolvedMs <= resolutionMs && rok;
      pct = 100;
      tone = okRes ? 'ok' : 'bad';
      badge = okRes ? 'ok' : 'bad';
      icon = okRes ? 'check' : 'alert';
    } else if (!terminal) {
      pct = linearProgress(nowMs, start, resolutionMs);
      if (nowMs > resolutionMs) {
        tone = 'bad';
        badge = 'bad';
        icon = 'alert';
      } else if (resolutionMs - nowMs <= 10 * 60 * 1000) {
        tone = 'warn';
        badge = focus === 'resolution' ? 'focus' : 'wait';
      } else {
        badge = focus === 'resolution' ? 'focus' : 'wait';
      }
    }

    rows.push({
      key: 'resolution',
      title: 'Resolução',
      pct,
      tone,
      deadlineLabel: format(new Date(resolutionMs), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR }),
      badge,
      icon,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      {rows.map((s) => (
        <div
          key={s.key}
          className={cn(
            'rounded-lg border px-3 py-2.5 transition-colors',
            s.badge === 'focus' ? 'border-primary/35 bg-primary/5' : 'border-border bg-background/30'
          )}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                {s.icon === 'check' ? (
                  <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />
                ) : s.icon === 'alert' ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
                ) : (
                  <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span className="truncate">{s.title}</span>
              </div>
              <div className="mt-1 font-mono text-[10px] text-muted-foreground">Prazo final · {s.deadlineLabel}</div>
            </div>
            {s.badge === 'wait' ? (
              <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                Aguardando
              </span>
            ) : s.badge === 'focus' ? (
              <span className="shrink-0 rounded-md bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                Em foco
              </span>
            ) : s.badge === 'ok' ? (
              <span className="shrink-0 rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600">
                Dentro do prazo
              </span>
            ) : (
              <span className="shrink-0 rounded-md bg-destructive/15 px-1.5 py-0.5 text-[10px] font-medium text-destructive">
                Fora do prazo
              </span>
            )}
          </div>
          <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className={cn('h-full rounded-full transition-all duration-500', toneBarClass(s.tone))}
              style={{ width: `${clampPct(s.pct)}%` }}
            />
          </div>
          <div className="mt-1 text-right font-mono text-[10px] text-muted-foreground">
            {s.badge === 'ok' || s.badge === 'bad' ? `${Math.round(clampPct(s.pct))}%` : `${Math.round(clampPct(s.pct))}% do intervalo`}
          </div>
        </div>
      ))}
    </div>
  );
}

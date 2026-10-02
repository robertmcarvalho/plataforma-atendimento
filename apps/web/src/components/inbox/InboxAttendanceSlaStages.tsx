'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { AlertTriangle, Check, Clock } from 'lucide-react';
import { InboxPanelCard, type InboxPanelProgressTone } from '@/components/inbox/InboxPanelCard';
import { semanticPillClass } from '@/lib/interactiveRow';
import { formatSlaCountdown, formatSlaOverdue } from '@/lib/sla/formatSlaDuration';

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

function formatDeadlineLines(ms: number): { primary: string; secondary: string } {
  const d = new Date(ms);
  return {
    primary: `Prazo final · ${format(d, 'dd/MM/yyyy', { locale: ptBR })}`,
    secondary: `às ${format(d, 'HH:mm', { locale: ptBR })}`,
  };
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

type RowTone = InboxPanelProgressTone;

const AT_RISK_MS = 10 * 60 * 1000;

export type ConversationSlaListBadgeState = {
  label: string;
  title: string;
  className: string;
};

/** Pill compacto para lista de conversas (C.12). */
export function getConversationSlaListBadgeState(
  d: AttendanceSlaStageDetail | null | undefined,
  nowMs: number
): ConversationSlaListBadgeState | null {
  if (!d || isSlaConversationTerminal(d)) return null;
  const deadlineIso = pickActiveSlaDeadlineForCountdown(d, nowMs);
  if (!deadlineIso) return null;
  const dueMs = new Date(deadlineIso).getTime();
  if (!Number.isFinite(dueMs)) return null;
  const diffMs = dueMs - nowMs;
  const title = `Prazo SLA: ${format(new Date(deadlineIso), "dd/MM/yyyy 'às' HH:mm", { locale: ptBR })}`;

  if (diffMs <= 0) {
    return {
      label: formatSlaOverdue(diffMs),
      title: `${title} (vencido)`,
      className: semanticPillClass('destructive', 'inbox-t-meta font-mono'),
    };
  }
  if (diffMs <= AT_RISK_MS) {
    return {
      label: formatSlaCountdown(diffMs),
      title,
      className: semanticPillClass('warning', 'inbox-t-meta font-mono'),
    };
  }
  return {
    label: formatSlaCountdown(diffMs),
    title,
    className: semanticPillClass('success', 'inbox-t-meta font-mono'),
  };
}

/** Prazo exibido no chip conforme a etapa em curso. */
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
  deadlineMs: number;
  badge: 'wait' | 'focus' | 'ok' | 'bad';
  icon: 'clock' | 'check' | 'alert';
};

function statusBadge(badge: Row['badge']): { label: string; tone: 'neutral' | 'primary' | 'success' | 'destructive' } {
  if (badge === 'wait') return { label: 'Aguardando', tone: 'neutral' };
  if (badge === 'focus') return { label: 'Em foco', tone: 'primary' };
  if (badge === 'ok') return { label: 'Dentro do prazo', tone: 'success' };
  return { label: 'Fora do prazo', tone: 'destructive' };
}

function stageIcon(icon: Row['icon']) {
  if (icon === 'check') return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" aria-hidden />;
  if (icon === 'alert') return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />;
  return <Clock className="h-3.5 w-3.5 shrink-0 text-foreground/70" aria-hidden />;
}

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
      } else if (firstMs - nowMs <= AT_RISK_MS) {
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

    rows.push({ key: 'first', title: '1ª resposta', pct, tone, deadlineMs: firstMs, badge, icon });
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
      } else if (treatmentMs - nowMs <= AT_RISK_MS) {
        tone = 'warn';
        badge = focus === 'treatment' ? 'focus' : 'wait';
      } else {
        badge = focus === 'treatment' ? 'focus' : 'wait';
      }
    }

    rows.push({ key: 'treatment', title: 'Tratamento', pct, tone, deadlineMs: treatmentMs, badge, icon });
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
      } else if (resolutionMs - nowMs <= AT_RISK_MS) {
        tone = 'warn';
        badge = focus === 'resolution' ? 'focus' : 'wait';
      } else {
        badge = focus === 'resolution' ? 'focus' : 'wait';
      }
    }

    rows.push({ key: 'resolution', title: 'Resolução', pct, tone, deadlineMs: resolutionMs, badge, icon });
  }

  if (rows.length === 0) return null;

  return (
    <div className="space-y-3">
      {rows.map((s) => {
        const deadline = formatDeadlineLines(s.deadlineMs);
        const badge = statusBadge(s.badge);
        const footerRight =
          s.badge === 'ok' || s.badge === 'bad'
            ? `${Math.round(clampPct(s.pct))}%`
            : `${Math.round(clampPct(s.pct))}% do intervalo`;

        return (
          <InboxPanelCard
            key={s.key}
            icon={stageIcon(s.icon)}
            title={s.title}
            badgeLabel={badge.label}
            badgeTone={badge.tone}
            metaPrimary={deadline.primary}
            metaSecondary={deadline.secondary}
            progressPct={s.pct}
            progressTone={s.tone}
            footerRight={footerRight}
          />
        );
      })}
    </div>
  );
}

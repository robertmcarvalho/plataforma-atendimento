/**
 * Formatação operacional de SLA — exibição em horas (H:MM) para prazos longos.
 * Armazenamento e configuração continuam em minutos no backend.
 */

/** Tempo restante a partir da diferença em ms (deadline - agora). */
export function formatSlaCountdown(diffMs: number): string {
  if (!Number.isFinite(diffMs)) return '--:--';
  if (diffMs <= 0) return formatSlaOverdue(diffMs);

  const totalSec = Math.max(0, Math.floor(diffMs / 1000));
  if (totalSec >= 3600) {
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    return `${hours}:${String(minutes).padStart(2, '0')}`;
  }

  const minutes = Math.floor(totalSec / 60);
  const seconds = totalSec % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

/** Countdown a partir de ISO de prazo e timestamp atual. */
export function formatSlaCountdownFromDeadline(
  deadlineIso: string | null | undefined,
  nowMs: number
): string {
  if (!deadlineIso) return '--:--';
  const dueMs = new Date(deadlineIso).getTime();
  if (!Number.isFinite(dueMs)) return '--:--';
  return formatSlaCountdown(dueMs - nowMs);
}

/** Prazo vencido — prefixo +H:MM (ex.: +2h15). */
export function formatSlaOverdue(diffMs: number): string {
  const overdueMs = Math.abs(diffMs);
  const totalMin = Math.ceil(overdueMs / 60_000);
  if (totalMin >= 60) {
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    return `+${h}h${String(m).padStart(2, '0')}`;
  }
  if (totalMin <= 59) return `+${totalMin}min`;
  return 'Vencido';
}

/** Duração estática em minutos (configuração, cards operação). */
export function formatSlaMinutes(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m >= 60 * 24) return `${Math.floor(m / (60 * 24))}d`;
  if (m >= 60) return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
  return `${m}min`;
}

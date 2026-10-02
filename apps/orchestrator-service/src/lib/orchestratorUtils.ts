import { logger } from './orchestratorContext';
import { LEGACY_INTENT_TO_SECTOR } from './orchestratorConfig';

export function normalizeIntent(intent?: string) {
  if (!intent) return '';
  const trimmed = intent.trim();
  return LEGACY_INTENT_TO_SECTOR[trimmed] || trimmed;
}

export function normalizeText(input?: string) {
  const raw = String(input || '').toLowerCase();
  return raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replaceAll(/\s+/g, ' ')
    .trim();
}

export function isUuid(value: unknown) {
  if (typeof value !== 'string') return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

export function toStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((x) => String(x || '').trim()).filter(Boolean);
}

export function elapsedMs(startedAt: number) {
  return Math.max(0, Date.now() - startedAt);
}

export function logDuration(
  step: string,
  startedAt: number,
  meta: Record<string, unknown>,
  targetMs?: number
) {
  const durationMs = elapsedMs(startedAt);
  const withinTarget = targetMs ? durationMs <= targetMs : true;
  logger.info('Duração da etapa do orquestrador', {
    event_type: 'orchestrator.duration',
    step,
    duration_ms: durationMs,
    target_ms: targetMs || null,
    within_target: withinTarget,
    ...meta,
  });
}

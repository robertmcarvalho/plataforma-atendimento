import type { KindKey, ModelKey } from '@/lib/automations/wizardTypes';

export function parseCsv(value: string): string[] {
  return String(value || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}

export function safeJsonParse(value: string) {
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === 'object') return { ok: true as const, value: parsed as Record<string, unknown> };
    return { ok: false as const, error: 'JSON inválido' };
  } catch {
    return { ok: false as const, error: 'JSON inválido' };
  }
}

export function slugifyFlowName(name: string): string {
  const base = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return base.length >= 2 ? base : 'fluxo';
}

export function stepLabel(step: number, kind: KindKey) {
  if (step === 1) return 'Modelo';
  if (step === 2) return 'Gatilho';
  if (step === 3) return kind === 'conversation_flow' ? 'Fluxo' : 'Ações';
  return 'Detalhes';
}

export function inferKindFromModel(model: ModelKey): KindKey {
  if (model === 'triagem_perfil' || model === 'csat' || model === 'out_of_hours' || model === 'sla_escalation') return 'conversation_flow';
  if (model === 'triage_bot') return 'bot_flow';
  if (model === 'keyword_routing') return 'routing_rule';
  return 'automation_rule';
}

import { BUILTIN_OPS_TASK_CATALOG, BUILTIN_TASK_TYPES } from './builtins';
import type {
  OpsTaskAutomationRule,
  OpsTaskCatalogEntry,
  OpsTaskCatalogStored,
  OpsTaskTrigger,
} from './types';
import { CUSTOM_ALLOWED_TRIGGERS, TASK_TYPE_SLUG_RE, TASK_TYPE_DISABLED_MESSAGE } from './types';
import { EVENT_TO_TRIGGER } from './automation';

export function defaultOpsTaskCatalog(): OpsTaskCatalogEntry[] {
  return BUILTIN_OPS_TASK_CATALOG.map((e) => ({ ...e }));
}

export function mergeOpsTaskCatalog(stored: OpsTaskCatalogStored | null | undefined): OpsTaskCatalogEntry[] {
  return mergeOpsTaskCatalogWithAutomation(stored);
}

function normalizeCustomTriggers(raw: OpsTaskCatalogEntry, automationRules?: OpsTaskAutomationRule[]): OpsTaskTrigger[] {
  const fromRaw = Array.isArray(raw.triggers)
    ? raw.triggers.filter((t): t is OpsTaskTrigger => CUSTOM_ALLOWED_TRIGGERS.includes(t as OpsTaskTrigger))
    : [];
  const fromRules = new Set<OpsTaskTrigger>();
  for (const rule of automationRules || []) {
    if (!rule.enabled || rule.task_type !== raw.task_type) continue;
    const trigger = EVENT_TO_TRIGGER[rule.event];
    if (trigger) fromRules.add(trigger);
  }
  return [...new Set<OpsTaskTrigger>(['manual', 'mcp', ...fromRaw, ...fromRules])];
}

function normalizeCustomEntry(
  raw: OpsTaskCatalogEntry,
  automationRules?: OpsTaskAutomationRule[]
): OpsTaskCatalogEntry {
  const task_type = String(raw.task_type || '').trim();
  return {
    task_type,
    label: String(raw.label || task_type).trim(),
    builtin: false,
    enabled: raw.enabled !== false,
    manual_create: raw.manual_create !== false,
    triggers: normalizeCustomTriggers(raw, automationRules),
    icon: raw.icon || 'ClipboardList',
    tone: raw.tone || 'muted',
    title_template: raw.title_template?.trim() || `${raw.label || task_type}: {driver_name}`,
  };
}

export function mergeOpsTaskCatalogWithAutomation(
  stored: OpsTaskCatalogStored | null | undefined,
  automationRules?: OpsTaskAutomationRule[]
): OpsTaskCatalogEntry[] {
  const defaults = defaultOpsTaskCatalog();
  const byType = new Map(defaults.map((e) => [e.task_type, { ...e }]));
  for (const entry of stored?.entries || []) {
    const type = String(entry.task_type || '').trim();
    if (!type) continue;
    const base = byType.get(type);
    if (base?.builtin) {
      byType.set(type, {
        ...base,
        label: entry.label?.trim() || base.label,
        enabled: entry.enabled !== false,
        manual_create: entry.manual_create ?? base.manual_create,
      });
    } else if (!base) {
      byType.set(type, normalizeCustomEntry(entry, automationRules));
    }
  }
  return Array.from(byType.values()).sort((a, b) => {
    if (a.builtin !== b.builtin) return a.builtin ? -1 : 1;
    return a.label.localeCompare(b.label, 'pt-BR');
  });
}

export function catalogEntryByType(
  catalog: OpsTaskCatalogEntry[],
  taskType: string
): OpsTaskCatalogEntry | undefined {
  return catalog.find((e) => e.task_type === taskType);
}

export function listManualCreateTypes(catalog: OpsTaskCatalogEntry[]): OpsTaskCatalogEntry[] {
  return catalog.filter((e) => e.enabled && e.manual_create);
}

export function formatTaskTitle(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '');
}

export class OpsTaskCatalogError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OpsTaskCatalogError';
  }
}

export function assertTaskTypeCreatable(
  catalog: OpsTaskCatalogEntry[],
  taskType: string,
  trigger: OpsTaskTrigger
): OpsTaskCatalogEntry {
  const entry = catalogEntryByType(catalog, taskType);
  if (!entry) {
    throw new OpsTaskCatalogError(`Tipo de tarefa desconhecido: ${taskType}`);
  }
  if (!entry.enabled) {
    throw new OpsTaskCatalogError(TASK_TYPE_DISABLED_MESSAGE);
  }
  if (!entry.triggers.includes(trigger)) {
    throw new OpsTaskCatalogError(
      `Tipo de tarefa "${entry.label}" não permite gatilho "${trigger}"`
    );
  }
  return entry;
}

export function isTaskTypeCreatable(
  catalog: OpsTaskCatalogEntry[],
  taskType: string,
  trigger: OpsTaskTrigger
): boolean {
  try {
    assertTaskTypeCreatable(catalog, taskType, trigger);
    return true;
  } catch {
    return false;
  }
}

export function validateOpsTaskCatalogPayload(value: unknown): { ok: true; data: OpsTaskCatalogStored } | { ok: false; error: string } {
  if (!value || typeof value !== 'object') {
    return { ok: false, error: 'Catálogo deve ser um objeto com entries' };
  }
  const entries = (value as OpsTaskCatalogStored).entries;
  if (!Array.isArray(entries)) {
    return { ok: false, error: 'entries deve ser um array' };
  }

  const seen = new Set<string>();

  for (const raw of entries) {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, error: 'Entrada inválida no catálogo' };
    }
    const task_type = String((raw as OpsTaskCatalogEntry).task_type || '').trim();
    if (!TASK_TYPE_SLUG_RE.test(task_type)) {
      return { ok: false, error: `task_type inválido: ${task_type}` };
    }
    if (seen.has(task_type)) {
      return { ok: false, error: `task_type duplicado: ${task_type}` };
    }
    seen.add(task_type);

    const isBuiltin = BUILTIN_TASK_TYPES.has(task_type);
    if (isBuiltin && (raw as OpsTaskCatalogEntry).builtin === false) {
      return { ok: false, error: `Não é permitido marcar built-in como custom: ${task_type}` };
    }
    if (!isBuiltin && (raw as OpsTaskCatalogEntry).builtin === true) {
      return { ok: false, error: `Tipo custom não pode ser built-in: ${task_type}` };
    }

    const label = String((raw as OpsTaskCatalogEntry).label || '').trim();
    if (!label) {
      return { ok: false, error: `label obrigatório para ${task_type}` };
    }
  }

  const merged = mergeOpsTaskCatalog({ entries: entries as OpsTaskCatalogEntry[] });
  for (const builtin of BUILTIN_TASK_TYPES) {
    if (!merged.some((e) => e.task_type === builtin)) {
      return { ok: false, error: `Built-in obrigatório ausente após merge: ${builtin}` };
    }
  }
  return { ok: true, data: { entries: merged } };
}

export type OpsTaskIconTone = 'primary' | 'warning' | 'destructive' | 'success' | 'info' | 'muted';

export type OpsTaskTrigger =
  | 'manual'
  | 'leader_precadastro'
  | 'leader_termination'
  | 'guided_demand'
  | 'orchestrator'
  | 'scheduler_doc'
  | 'internal_note'
  | 'mcp';

export type OpsTaskCatalogEntry = {
  task_type: string;
  label: string;
  builtin: boolean;
  enabled: boolean;
  manual_create: boolean;
  triggers: OpsTaskTrigger[];
  icon: string;
  tone: OpsTaskIconTone;
  title_template: string;
};

export type OpsTaskCatalogStored = {
  entries: OpsTaskCatalogEntry[];
};

/** Gatilhos que tipos custom podem receber via configuração / regras de automação. */
export const CUSTOM_ALLOWED_TRIGGERS: OpsTaskTrigger[] = [
  'manual',
  'mcp',
  'internal_note',
  'orchestrator',
  'scheduler_doc',
];

export type OpsTaskAutomationEvent =
  | 'internal_note_pattern'
  | 'driver_doc_expiring'
  | 'driver_doc_expired';

export type OpsTaskAutomationRule = {
  id: string;
  event: OpsTaskAutomationEvent;
  task_type: string;
  enabled: boolean;
  /** Regex (flag i) para `internal_note_pattern`. */
  pattern?: string;
  /** Dias antes do vencimento para `driver_doc_expiring`. */
  days_before?: number;
};

export type OpsTaskAutomationRulesStored = {
  rules: OpsTaskAutomationRule[];
};

export const OPS_TASK_TRIGGER_LABELS: Record<OpsTaskTrigger, string> = {
  manual: 'Manual (/operacao)',
  mcp: 'MCP',
  leader_precadastro: 'Pré-cadastro líder',
  leader_termination: 'Desligamento líder',
  guided_demand: 'Demanda guiada',
  orchestrator: 'Orquestrador',
  scheduler_doc: 'Documentos (agendador)',
  internal_note: 'Nota interna',
};

export const TASK_TYPE_SLUG_RE = /^[a-z][a-z0-9_]{2,60}$/;

export const TASK_TYPE_DISABLED_MESSAGE =
  'Tipo de tarefa desabilitado nas configurações de Operação';

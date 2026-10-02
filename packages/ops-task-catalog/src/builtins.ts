import type { OpsTaskCatalogEntry } from './types';

/** Catálogo built-in — labels no vocabulário Revive ("gerar"). */
export const BUILTIN_OPS_TASK_CATALOG: OpsTaskCatalogEntry[] = [
  {
    task_type: 'driver_pre_registration',
    label: 'Pré-cadastro',
    builtin: true,
    enabled: true,
    manual_create: false,
    triggers: ['leader_precadastro'],
    icon: 'FilePlus2',
    tone: 'primary',
    title_template: 'Pré-cadastro: {driver_name}',
  },
  {
    task_type: 'driver_registration_completion',
    label: 'Finalizar cadastro',
    builtin: true,
    enabled: true,
    manual_create: true,
    triggers: ['manual', 'orchestrator', 'internal_note', 'leader_precadastro'],
    icon: 'FilePlus2',
    tone: 'primary',
    title_template: 'Finalizar cadastro: {driver_name}',
  },
  {
    task_type: 'driver_enrollment_prep',
    label: 'Gerar matrícula',
    builtin: true,
    enabled: true,
    manual_create: true,
    triggers: ['manual', 'leader_precadastro'],
    icon: 'IdCard',
    tone: 'warning',
    title_template: 'Gerar matrícula: {driver_name}',
  },
  {
    task_type: 'driver_termination_prep',
    label: 'Gerar termo de desligamento',
    builtin: true,
    enabled: true,
    manual_create: true,
    triggers: ['manual'],
    icon: 'FileMinus2',
    tone: 'destructive',
    title_template: 'Gerar termo de desligamento: {driver_name}',
  },
  {
    task_type: 'driver_termination_request',
    label: 'Termo de desligamento',
    builtin: true,
    enabled: true,
    manual_create: false,
    triggers: ['leader_termination'],
    icon: 'FileMinus2',
    tone: 'destructive',
    title_template: 'Termo de desligamento: {driver_name}',
  },
  {
    task_type: 'driver_termination_financial_review',
    label: 'Acerto de desligamento',
    builtin: true,
    enabled: true,
    manual_create: false,
    triggers: ['leader_termination'],
    icon: 'Wallet',
    tone: 'warning',
    title_template: 'Acerto de desligamento: {driver_name}',
  },
  {
    task_type: 'financial_advance_request',
    label: 'Autorizar adiantamento',
    builtin: true,
    enabled: true,
    manual_create: false,
    triggers: ['guided_demand'],
    icon: 'Wallet',
    tone: 'primary',
    title_template: 'Autorizar adiantamento: {driver_name}',
  },
  {
    task_type: 'driver_doc_expiry_warning',
    label: 'Documento a vencer',
    builtin: true,
    enabled: true,
    manual_create: false,
    triggers: ['scheduler_doc'],
    icon: 'FileWarning',
    tone: 'warning',
    title_template: 'Documento a vencer: {driver_name}',
  },
  {
    task_type: 'driver_doc_expired',
    label: 'Documento vencido',
    builtin: true,
    enabled: true,
    manual_create: false,
    triggers: ['scheduler_doc'],
    icon: 'AlertTriangle',
    tone: 'destructive',
    title_template: 'Documento vencido: {driver_name}',
  },
  {
    task_type: 'guided_demand',
    label: 'Demanda guiada',
    builtin: true,
    enabled: true,
    manual_create: false,
    triggers: ['orchestrator', 'guided_demand'],
    icon: 'ClipboardList',
    tone: 'primary',
    title_template: 'Demanda guiada',
  },
];

export const BUILTIN_TASK_TYPES = new Set(BUILTIN_OPS_TASK_CATALOG.map((e) => e.task_type));

/**
 * Alias legado `task_kind` → `task_type` (criação manual de tarefas).
 * Mantido para clientes antigos que ainda enviam `task_kind` no body da API;
 * preferir `task_type` em integrações novas. Ver `resolveManualTaskType` na API.
 */
export const LEGACY_TASK_KIND_TO_TYPE: Record<string, string> = {
  finalizar_cadastro: 'driver_registration_completion',
  preparar_matricula: 'driver_enrollment_prep',
  preparar_desligamento: 'driver_termination_prep',
};

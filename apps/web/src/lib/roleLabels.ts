/** Rótulos em português para nomes de perfil (roles.name no backend). */
export const ROLE_DISPLAY_NAME_PT: Record<string, string> = {
  admin: 'Administrador',
  supervisor: 'Gestor Operacional',
  attendant: 'Atendente',
  attendant_financeiro: 'Atendente Financeiro',
  operational: 'Analista Operacional',
  financial: 'Gestor Financeiro',
  financial_auditor: 'Auditor financeiro',
  leader: 'Líder',
  commercial: 'Comercial',
  sales: 'Vendas',
};

export function roleDisplayNamePt(name: string | undefined | null): string {
  if (!name) return '—';
  return ROLE_DISPLAY_NAME_PT[name] ?? name;
}

/** Módulos de permissão (primeiro nível do JSON). */
export const PERMISSION_MODULE_LABELS_PT: Record<string, string> = {
  all: 'Acesso total',
  conversations: 'Conversas',
  reports: 'Relatórios',
  sla: 'SLA',
  campaigns: 'Campanhas',
  automations: 'Automações',
  templates: 'Modelos de mensagem',
  notes: 'Notas internas',
  pharmacies: 'Farmácias',
  drivers: 'Motoristas',
  leaders: 'Líderes',
  financial: 'Financeiro',
  billing: 'Faturamento',
  leader_panel: 'Portal do líder',
};

/** Ações por módulo (segundo nível). */
export const PERMISSION_ACTION_LABELS_PT: Record<string, Record<string, string>> = {
  conversations: {
    view: 'Visualizar',
    assign: 'Atribuir',
    transfer: 'Transferir',
    close: 'Encerrar',
    reply: 'Responder',
  },
  reports: { view: 'Visualizar' },
  sla: { view: 'Visualizar', manage: 'Gerenciar' },
  campaigns: { view: 'Visualizar', create: 'Criar' },
  automations: { view: 'Visualizar' },
  templates: { view: 'Visualizar', use: 'Usar' },
  notes: { create: 'Criar' },
  pharmacies: { view: 'Visualizar', manage: 'Gerenciar' },
  drivers: { view: 'Visualizar', manage: 'Gerenciar' },
  leaders: { view: 'Visualizar', manage: 'Gerenciar' },
  financial: {
    view: 'Visualizar',
    manage: 'Gerenciar',
    approve: 'Aprovar',
    export: 'Exportar',
    reconcile: 'Conciliar',
  },
  billing: {
    view: 'Visualizar',
    manage: 'Gerenciar',
  },
  leader_panel: { view: 'Visualizar', manage: 'Gerenciar' },
  commercial: { view: 'Visualizar', manage: 'Gerenciar' },
};

export function permissionModuleLabelPt(key: string): string {
  return PERMISSION_MODULE_LABELS_PT[key] ?? key;
}

export function permissionActionLabelPt(moduleKey: string, actionKey: string): string {
  return PERMISSION_ACTION_LABELS_PT[moduleKey]?.[actionKey] ?? actionKey;
}

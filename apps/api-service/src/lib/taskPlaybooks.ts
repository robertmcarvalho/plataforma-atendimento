export type PlaybookStep = { id: string; label: string; done?: boolean };

export type TaskPlaybook = {
  steps: PlaybookStep[];
  current_step: string;
  permissions: Array<'attendant' | 'financial' | 'supervisor' | 'operational' | 'admin' | 'leader'>;
};

const DEFAULT: TaskPlaybook = {
  steps: [
    { id: 'review', label: 'Revisar contexto' },
    { id: 'act', label: 'Executar ação' },
    { id: 'close', label: 'Concluir pendência' },
  ],
  current_step: 'review',
  permissions: ['attendant', 'supervisor', 'financial', 'operational'],
};

export const CODE_TASK_PLAYBOOKS: Record<string, TaskPlaybook> = {
  guided_demand: {
    steps: [
      { id: 'read', label: 'Ler demanda' },
      { id: 'reply', label: 'Responder no chat' },
      { id: 'done', label: 'Concluir' },
    ],
    current_step: 'read',
    permissions: ['attendant', 'supervisor'],
  },
  financial_advance_request: {
    steps: [
      { id: 'review', label: 'Analisar na Inbox' },
      { id: 'decide', label: 'Aprovar ou reprovar' },
      { id: 'entry', label: 'Registrar lançamento (se aprovado)' },
    ],
    current_step: 'review',
    permissions: ['financial', 'supervisor', 'admin'],
  },
  driver_pre_registration: {
    steps: [
      { id: 'gaps', label: 'Ver lacunas do cadastro' },
      { id: 'form', label: 'Completar cadastro' },
      { id: 'enrollment_docs', label: 'Validar documentos de matrícula' },
      { id: 'enrollment_register', label: 'Gerar matrícula no Autentique' },
      { id: 'done', label: 'Concluir pré-cadastro' },
    ],
    current_step: 'gaps',
    permissions: ['attendant', 'supervisor'],
  },
  driver_registration_completion: {
    steps: [
      { id: 'gaps', label: 'Ver lacunas' },
      { id: 'form', label: 'Completar cadastro' },
      { id: 'done', label: 'Concluir' },
    ],
    current_step: 'gaps',
    permissions: ['attendant', 'supervisor'],
  },
  driver_termination_request: {
    steps: [
      { id: 'review', label: 'Revisar desligamento' },
      { id: 'decide', label: 'Aprovar ou reprovar' },
    ],
    current_step: 'review',
    permissions: ['attendant', 'supervisor'],
  },
  driver_enrollment_prep: {
    steps: [
      { id: 'docs', label: 'Validar documentos' },
      { id: 'register', label: 'Registrar dados de matrícula' },
      { id: 'done', label: 'Concluir preparação' },
    ],
    current_step: 'docs',
    permissions: ['attendant', 'supervisor', 'operational'],
  },
  driver_termination_prep: {
    steps: [
      { id: 'reason', label: 'Registrar motivo' },
      { id: 'pending', label: 'Calcular pendências' },
      { id: 'done', label: 'Concluir preparação' },
    ],
    current_step: 'reason',
    permissions: ['attendant', 'supervisor', 'operational'],
  },
  driver_termination_financial_review: {
    steps: [
      { id: 'review', label: 'Revisar pendências financeiras' },
      { id: 'settle', label: 'Registrar acerto' },
      { id: 'done', label: 'Concluir' },
    ],
    current_step: 'review',
    permissions: ['financial', 'supervisor', 'admin'],
  },
  driver_doc_expiry_warning: {
    steps: [
      { id: 'review', label: 'Ver validade do documento' },
      { id: 'cadastro', label: 'Atualizar cadastro do entregador' },
      { id: 'done', label: 'Concluir pendência' },
    ],
    current_step: 'review',
    permissions: ['attendant', 'supervisor', 'leader'],
  },
  driver_doc_expired: {
    steps: [
      { id: 'review', label: 'Confirmar documento vencido' },
      { id: 'cadastro', label: 'Renovar e atualizar cadastro' },
      { id: 'done', label: 'Concluir pendência' },
    ],
    current_step: 'review',
    permissions: ['attendant', 'supervisor', 'leader'],
  },
};

const MAP = CODE_TASK_PLAYBOOKS;

export function getTaskPlaybook(taskType: string, metadata?: Record<string, unknown>): TaskPlaybook {
  const base = MAP[taskType] || DEFAULT;
  const phase = String(metadata?.phase || '');
  if (taskType === 'financial_advance_request') {
    if (phase === 'awaiting_entry') return { ...base, current_step: 'entry' };
    if (phase === 'rejected' || phase === 'rejection_followup') return { ...base, current_step: 'decide' };
    if (metadata?.decision) return { ...base, current_step: 'decide' };
  }
  return base;
}

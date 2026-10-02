import type { ExecutionBoard, FinancialOperationsHub, OpsHubTaskRow, PortfolioOperationsHub } from '@/lib/ops/opsAnalyticsApi';
import {
  formatPrazoLabel,
  resolveRevivePriority,
  resolveReviveTaskStatus,
} from '@/lib/operacao/operacaoTaskReviveUtils';
import { initialsFromName } from '@/lib/operacao/operacaoTaskMeta';
import { alertaTipoLabel } from '@/lib/operacao/reviveCopy/alertaTipoLabel';
import type {
  AlertaOperacional,
  ComplianceEntregador,
  EventoCiclo,
  FarmaciaOperacional,
  KpiOperacional,
  NotificacaoPendencia,
  ReviveFilaViewModel,
  ReviveGestorFinanceiroViewModel,
  ReviveOperacaoViewModel,
  TarefaAtendimento,
  TarefaTipo,
} from './operacaoReviveTypes';

const TASK_TYPE_MAP: Record<string, TarefaTipo> = {
  driver_pre_registration: 'pre_cadastro',
  driver_registration_completion: 'finalizar_cadastro',
  driver_enrollment_prep: 'gerar_matricula',
  driver_termination_prep: 'gerar_termo_desligamento',
  driver_termination_request: 'gerar_termo_desligamento',
  driver_termination_financial_review: 'acerto_desligamento',
  financial_advance_request: 'autorizar_adiantamento',
  guided_demand: 'demanda_guiada',
  driver_doc_expiry_warning: 'documento_a_vencer',
  driver_doc_expired: 'documento_vencido',
};

function mapTaskType(taskType: string): TarefaTipo | null {
  return TASK_TYPE_MAP[taskType] ?? null;
}

export function mapTaskRows(tasks: OpsHubTaskRow[]): TarefaAtendimento[] {
  return tasks.flatMap((t) => {
    const tipo = mapTaskType(t.task_type);
    if (!tipo) return [];
    return [{
    id: t.id,
    tipo,
    setor: t.task_type.includes('financial') || t.task_type.includes('advance') ? 'financeiro' : 'atendimento_geral',
    entregadorId: t.driver_id,
    entregadorNome: t.driver_name || 'Entregador',
    entregadorIniciais: t.driver_initials || initialsFromName(t.driver_name || ''),
    farmacia: t.pharmacy_name || '—',
    atendenteNome: t.assignee_name || '—',
    atendenteIniciais: initialsFromName(t.assignee_name || ''),
    checklist: (t.checklist || []).map((c) => ({ label: c.label, done: c.done })),
    slaMinutos: t.sla_minutes || 240,
    decorridoMinutos: t.elapsed_minutes || 0,
    prazo: formatPrazoLabel(t),
    status: resolveReviveTaskStatus(t),
    prioridade: resolveRevivePriority(t.priority),
    signatureStatus: t.signature_status,
  }];
  });
}

function mapKpisFromRows(kpis: PortfolioOperationsHub['kpis']): KpiOperacional[] {
  return (kpis || []).map((k) => ({
    label: k.label,
    valor: String(k.value),
    delta: k.delta,
    deltaTipo: k.delta_tone,
    spark: k.spark,
    alerta: k.alert,
  }));
}

function mapAlertaRow(a: NonNullable<PortfolioOperationsHub['alerts_revive']>[number]): AlertaOperacional {
  const tipo = a.tipo;
  const overdueLike = tipo === 'task_overdue' || tipo === 'sla' || tipo === 'settlement_overdue';
  return {
    id: a.id,
    tipo,
    tipoLabel: alertaTipoLabel(tipo),
    descricao: a.descricao,
    farmacia: a.farmacia,
    timestamp: a.timestamp,
    nivel: a.nivel,
    setor: 'operacao',
    acao: overdueLike ? 'open_overdue_task' : undefined,
    href: a.href,
  };
}

function mapAlertasFromRevive(
  alerts: PortfolioOperationsHub['alerts_revive'],
  setor: 'atendimento_geral' | 'financeiro'
): AlertaOperacional[] {
  const rows = (alerts || []).map(mapAlertaRow);
  if (setor === 'atendimento_geral') {
    return rows;
  }
  return rows.filter((a) => a.setor === 'financeiro' || a.setor === 'operacao');
}

function mapCompliance(hub: PortfolioOperationsHub): ComplianceEntregador[] {
  return (hub.compliance || []).map((c) => ({
    id: c.driver_id,
    nome: c.name,
    iniciais: c.initials,
    farmacia: c.pharmacy_name,
    certificadoDigital: c.cert_digital,
    mei: c.mei,
    matricula: c.matricula_signed,
  }));
}

function mapCycleEvent(e: NonNullable<PortfolioOperationsHub['cycle_events']>[number]): EventoCiclo {
  return {
    id: e.id,
    tipo: e.tipo,
    entregadorNome: e.driver_name,
    entregadorIniciais: e.driver_initials,
    data: e.data,
    farmacia: e.pharmacy_name,
    liderNome: e.leader_name,
    atendenteNome: e.attendant_name,
    status: e.status,
    assinaturaTermo: e.termination_signature_label ?? null,
    prazoAcerto: e.settlement_due_at
      ? new Date(e.settlement_due_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })
      : null,
    diasAcertoRestantes: e.settlement_days_remaining ?? null,
    riscoSubstituicao: Boolean(e.substitution_risk),
  };
}

function mapEventos(hub: PortfolioOperationsHub): EventoCiclo[] {
  return (hub.cycle_events || []).map(mapCycleEvent);
}

function mapNotificacoes(
  items: NonNullable<PortfolioOperationsHub['signature_pending']>
): NotificacaoPendencia[] {
  return (items || []).map((s) => ({
    id: s.id,
    tarefaId: s.id,
    tipo: s.type === 'matricula' ? 'matricula' : 'termo_desligamento',
    entregadorNome: s.driver_name,
    entregadorIniciais: s.driver_initials,
    farmacia: s.pharmacy_name,
    diasPendente: s.days_pending,
    prazoDias: s.deadline_days,
  }));
}

function mapAlertas(hub: PortfolioOperationsHub): AlertaOperacional[] {
  return (hub.alerts_revive || []).map(mapAlertaRow);
}

function mapKpis(hub: PortfolioOperationsHub): KpiOperacional[] {
  return (hub.kpis || []).map((k) => ({
    label: k.label,
    valor: String(k.value),
    delta: k.delta,
    deltaTipo: k.delta_tone,
    spark: k.spark,
    alerta: k.alert,
  }));
}

function mapFarmacias(hub: PortfolioOperationsHub): FarmaciaOperacional[] {
  return (hub.pharmacy_cards || []).map((p) => ({
    id: p.id,
    nome: p.trade_name,
    cidade: p.city || '—',
    liderId: p.leader_id || '',
    liderNome: p.leader_name || '—',
    liderIniciais: p.leader_initials,
    liderStatus: 'online' as const,
    entregadoresAtivos: p.drivers_active,
    entregadoresTotal: p.drivers_total,
    filaChats: p.open_conversations,
    pedidosPendentes: p.pending_financial,
    sla: p.sla_percent,
  }));
}

export const EMPTY_OPERACAO_VIEW: ReviveOperacaoViewModel = {
  kpis: [],
  farmacias: [],
  alertas: [],
  notificacoes: [],
  compliance: [],
  tarefas: [],
  eventos: [],
};

export const EMPTY_FILA_VIEW: ReviveFilaViewModel = {
  kpis: [],
  alertas: [],
  notificacoes: [],
  tarefas: [],
  eventos: [],
};

export const EMPTY_GESTOR_FINANCEIRO_VIEW: ReviveGestorFinanceiroViewModel = {
  kpis: [],
  alertas: [],
  notificacoes: [],
  tarefas: [],
  eventos: [],
  desempenhoSetor: [],
};

export function hubToReviveModel(hub: PortfolioOperationsHub): ReviveOperacaoViewModel {
  return {
    kpis: mapKpis(hub),
    farmacias: mapFarmacias(hub),
    alertas: mapAlertas(hub),
    notificacoes: mapNotificacoes(hub.signature_pending || []),
    compliance: mapCompliance(hub),
    tarefas: mapTaskRows(hub.tasks),
    eventos: mapEventos(hub),
  };
}

export function executionBoardToReviveModel(
  board: ExecutionBoard,
  mode: 'geral' | 'financeiro'
): ReviveFilaViewModel {
  const setorFilter = mode === 'geral' ? 'atendimento_geral' : 'financeiro';
  let tarefas = mapTaskRows(board.tasks);
  if (mode === 'geral') {
    tarefas = tarefas.filter((t) => t.setor === 'atendimento_geral');
  } else {
    tarefas = tarefas.filter((t) => t.setor === 'financeiro' && t.tipo !== 'autorizar_adiantamento');
  }
  return {
    kpis: mapKpisFromRows(board.kpis),
    alertas: mapAlertasFromRevive(board.alerts_revive, setorFilter),
    notificacoes: mapNotificacoes(board.signature_pending || []),
    tarefas,
    eventos: (board.cycle_events || []).map(mapCycleEvent),
  };
}

export function financialHubToReviveModel(hub: FinancialOperationsHub): ReviveGestorFinanceiroViewModel {
  return {
    kpis: mapKpisFromRows(hub.kpis),
    alertas: mapAlertasFromRevive(hub.alerts_revive, 'financeiro'),
    notificacoes: mapNotificacoes(hub.signature_pending || []),
    tarefas: mapTaskRows(hub.tasks).filter((t) => t.setor === 'financeiro'),
    eventos: (hub.cycle_events || []).map(mapCycleEvent),
    desempenhoSetor: buildDesempenhoSetorFromTasks(hub.tasks),
  };
}

function buildDesempenhoSetorFromTasks(tasks: OpsHubTaskRow[]) {
  const byAssignee = new Map<string, { nome: string; tarefas: number; overdue: number }>();
  const now = Date.now();
  for (const t of tasks) {
    const id = t.assignee_id || 'sem-atendente';
    const nome = t.assignee_name || 'Sem atendente';
    const row = byAssignee.get(id) || { nome, tarefas: 0, overdue: 0 };
    row.tarefas += 1;
    if (t.due_at && new Date(t.due_at).getTime() < now) row.overdue += 1;
    byAssignee.set(id, row);
  }
  return [...byAssignee.values()]
    .map((a) => {
      const sla = a.tarefas ? Math.max(0, Math.round(((a.tarefas - a.overdue) / a.tarefas) * 100)) : 0;
      const parts = a.nome.split(' ').filter(Boolean);
      const iniciais = parts
        .slice(0, 2)
        .map((p) => p[0]?.toUpperCase() || '')
        .join('');
      return { nome: a.nome, iniciais: iniciais || '—', tarefas: a.tarefas, sla };
    })
    .sort((a, b) => b.tarefas - a.tarefas);
}

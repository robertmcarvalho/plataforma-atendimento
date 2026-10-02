// Tipos da UI de operação (view-model; dados vêm da API via hubToReviveModel).

export type EntregadorStatus = 'rota' | 'disponivel' | 'pausa' | 'offline';
export type AlertaNivel = 'destructive' | 'warning' | 'success' | 'info';

export interface FarmaciaOperacional {
  id: string;
  nome: string;
  cidade: string;
  liderId: string;
  liderNome: string;
  liderIniciais: string;
  liderStatus: 'online' | 'idle' | 'busy' | 'offline';
  entregadoresAtivos: number;
  entregadoresTotal: number;
  filaChats: number;
  pedidosPendentes: number;
  sla: number;
}

export interface AlertaOperacional {
  id: string;
  tipo: string;
  tipoLabel: string;
  descricao: string;
  farmacia: string;
  timestamp: string;
  nivel: AlertaNivel;
  setor?: 'atendimento_geral' | 'financeiro' | 'operacao' | 'lider';
  /** Abre a primeira tarefa atrasada do painel atual. */
  acao?: 'open_overdue_task';
  href?: string;
}

export interface KpiOperacional {
  label: string;
  valor: string;
  delta?: string;
  deltaTipo?: 'up' | 'down' | 'neutral';
  spark: number[];
  alerta?: boolean;
}

export interface ComplianceEntregador {
  id: string;
  nome: string;
  iniciais: string;
  farmacia: string;
  certificadoDigital: boolean;
  mei: boolean;
  matricula: boolean;
}

export type TarefaTipo =
  | 'pre_cadastro'
  | 'finalizar_cadastro'
  | 'gerar_matricula'
  | 'gerar_termo_desligamento'
  | 'acerto_desligamento'
  | 'lancamento_cotas'
  | 'autorizar_adiantamento'
  | 'demanda_guiada'
  | 'documento_a_vencer'
  | 'documento_vencido';

export type TarefaStatus = 'em_andamento' | 'atrasada' | 'concluida' | 'aguardando';
export type TarefaPrioridade = 'baixa' | 'media' | 'alta';

export interface ChecklistItem {
  label: string;
  done: boolean;
}

export interface Comentario {
  id: string;
  autor: string;
  iniciais: string;
  texto: string;
  mencoes: string[];
  timestamp: string;
}

export interface TarefaAtendimento {
  id: string;
  tipo: TarefaTipo;
  setor: 'atendimento_geral' | 'financeiro';
  entregadorId?: string | null;
  entregadorNome: string;
  entregadorIniciais: string;
  farmacia: string;
  atendenteNome: string;
  atendenteIniciais: string;
  checklist: ChecklistItem[];
  slaMinutos: number;
  decorridoMinutos: number;
  prazo: string;
  status: TarefaStatus;
  prioridade: TarefaPrioridade;
  signatureStatus?: string | null;
  anotacoes?: string;
  comentarios?: Comentario[];
  escaladaPara?: string;
  concluidaEm?: string;
}

export interface NotificacaoPendencia {
  id: string;
  tipo: 'termo_desligamento' | 'matricula';
  entregadorNome: string;
  entregadorIniciais: string;
  farmacia: string;
  diasPendente: number;
  prazoDias: number;
  tarefaId?: string;
}

export interface EventoCiclo {
  id: string;
  tipo: 'entrada' | 'desligamento';
  entregadorNome: string;
  entregadorIniciais: string;
  data: string;
  farmacia: string;
  liderNome: string;
  atendenteNome: string;
  status: 'concluido' | 'em_andamento' | 'pendente';
  assinaturaTermo?: string | null;
  prazoAcerto?: string | null;
  diasAcertoRestantes?: number | null;
  riscoSubstituicao?: boolean;
}

export interface ReviveOperacaoViewModel {
  kpis: KpiOperacional[];
  farmacias: FarmaciaOperacional[];
  alertas: AlertaOperacional[];
  notificacoes: NotificacaoPendencia[];
  compliance: ComplianceEntregador[];
  tarefas: TarefaAtendimento[];
  eventos: EventoCiclo[];
}

export interface ReviveFilaViewModel {
  kpis: KpiOperacional[];
  alertas: AlertaOperacional[];
  notificacoes: NotificacaoPendencia[];
  tarefas: TarefaAtendimento[];
  eventos: EventoCiclo[];
}

export interface ReviveGestorFinanceiroViewModel extends ReviveFilaViewModel {
  desempenhoSetor: Array<{ nome: string; iniciais: string; tarefas: number; sla: number }>;
}

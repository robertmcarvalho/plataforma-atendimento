import api from '@/lib/api';
import { buildOpsHubQueryParams } from '@/lib/ops/opsHubQuery';
import type { OccurrenceDriverOption, OccurrencePharmacyOption } from '@/lib/occurrenceForm';

export type PortfolioSummary = {
  period_days: number;
  totals: {
    pharmacies: number;
    drivers: number;
    leaders: number;
    open_conversations: number;
    pending_financial: number;
    open_tasks: number;
    doc_alerts: number;
    absences_without_coverage: number;
  };
  pharmacies: Array<{
    id: string;
    trade_name: string;
    leader_id: string | null;
    leader_name: string | null;
    drivers_count: number;
    open_conversations: number;
    sla_percent: number;
    pending_financial: number;
    pending_absences: number;
    pending_dailies: number;
  }>;
  leaders: Array<{
    id: string;
    name: string;
    pharmacies_count: number;
    pending_absences: number;
    pending_dailies: number;
  }>;
  alerts: Array<{ severity: string; type: string; message: string; href?: string }>;
};

export type LaunchContext = {
  leaders: Array<{ id: string; name: string; pharmacy_ids: string[] }>;
  pharmacies: OccurrencePharmacyOption[];
  drivers: OccurrenceDriverOption[];
};

export type CoordinationSummary = {
  period_days: number;
  totals: {
    pharmacies_active: number;
    leaders_active: number;
    drivers_active: number;
    open_conversations: number;
    pending_financial: number;
    absences_without_coverage_pct: number;
  };
  financial_funnel: Record<string, number>;
  leaders: Array<{
    id: string;
    name: string;
    status: string;
    pharmacies_count: number;
    pending_absences: number;
    pending_dailies: number;
    sla_percent: number;
  }>;
  pharmacies: PortfolioSummary['pharmacies'];
  attendant_occurrences: Array<{
    attendant_id: string;
    attendant_name: string;
    count: number;
    by_leader: Array<{ leader_id: string; leader_name: string; count: number }>;
  }>;
};

export type OpsKpiRow = {
  label: string;
  value: string | number;
  delta?: string;
  delta_tone?: 'up' | 'down' | 'neutral';
  spark: number[];
  alert?: boolean;
};

export type OpsPharmacyCard = {
  id: string;
  trade_name: string;
  city?: string | null;
  leader_id: string | null;
  leader_name: string | null;
  leader_initials: string;
  sla_percent: number;
  drivers_active: number;
  drivers_total: number;
  open_conversations: number;
  pending_financial: number;
};

export type OpsComplianceRow = {
  driver_id: string;
  name: string;
  initials: string;
  pharmacy_name: string;
  cert_digital: boolean;
  mei: boolean;
  matricula_signed: boolean;
};

export type OpsCycleEventRow = {
  id: string;
  tipo: 'entrada' | 'desligamento';
  driver_id?: string;
  driver_name: string;
  driver_initials: string;
  data: string;
  effective_date?: string;
  pharmacy_id?: string;
  pharmacy_name: string;
  leader_name: string;
  attendant_name: string;
  status: 'concluido' | 'em_andamento' | 'pendente';
  substitution_risk?: boolean;
  termination_signature_status?: string | null;
  termination_signature_label?: string | null;
  settlement_due_at?: string | null;
  settlement_days_remaining?: number | null;
};

export type OpsSignaturePending = {
  id: string;
  driver_id: string;
  driver_name: string;
  driver_initials: string;
  pharmacy_name: string;
  type: 'matricula' | 'termo_desligamento';
  signature_status?: string | null;
  signature_status_label?: string;
  days_pending: number;
  deadline_days: number;
};

export type OpsAlertRevive = {
  id: string;
  tipo: string;
  nivel: 'destructive' | 'warning' | 'success' | 'info';
  descricao: string;
  farmacia: string;
  timestamp: string;
  href?: string;
};

export async function fetchPortfolioSummary(period = 30) {
  const { data } = await api.get<PortfolioSummary>('/api/ops-analytics/portfolio', { params: { period } });
  return data;
}

export async function fetchPortfolioLaunchContext(leaderId?: string) {
  const { data } = await api.get<LaunchContext>('/api/ops-analytics/portfolio/launch-context', {
    params: leaderId ? { leader_id: leaderId } : undefined,
  });
  return data;
}

export async function fetchCoordinationSummary(period = 30) {
  const { data } = await api.get<CoordinationSummary>('/api/ops-analytics/coordination', { params: { period } });
  return data;
}

export type GestorOperacionalAttendant = { id: string; name: string };

export type GestorOperacionalHub = PortfolioOperationsHub & {
  attendants_scope?: number;
};

export async function fetchGestorOperacionalAttendants() {
  const { data } = await api.get<{ attendants: GestorOperacionalAttendant[] }>(
    '/api/ops-analytics/gestor-operacional/attendants'
  );
  return data;
}

export async function fetchGestorOperacionalHub(
  period = 30,
  attendantId?: string,
  opts?: { referenceDate?: string; pharmacyId?: string }
) {
  const { data } = await api.get<GestorOperacionalHub>('/api/ops-analytics/gestor-operacional/hub', {
    params: buildOpsHubQueryParams({
      period,
      attendantId,
      referenceDate: opts?.referenceDate,
      pharmacyId: opts?.pharmacyId,
    }),
  });
  return data;
}

export type PortfolioAlert = PortfolioSummary['alerts'][number];

export type OpsHubTaskRow = {
  id: string;
  task_type: string;
  title: string;
  status: string;
  priority: string;
  due_at: string | null;
  assignee_id: string | null;
  assignee_name: string | null;
  driver_id: string | null;
  driver_name: string | null;
  conversation_id: string | null;
  pharmacy_name: string | null;
  signature_status: string | null;
  checklist?: Array<{ label: string; done: boolean }>;
  sla_minutes?: number | null;
  elapsed_minutes?: number | null;
  prazo_label?: string | null;
  driver_initials?: string;
};

export type OpsHubConversationRow = {
  id: string;
  status: string;
  priority: string;
  pharmacy_name: string | null;
  contact_name: string | null;
  attendant_name: string | null;
  updated_at: string;
};

export type PortfolioOperationsHub = {
  period_days: number;
  reference_date?: string | null;
  pharmacy_id?: string | null;
  summary: PortfolioSummary;
  tasks: OpsHubTaskRow[];
  conversations: OpsHubConversationRow[];
  notifications: PortfolioAlert[];
  kpis?: OpsKpiRow[];
  pharmacy_cards?: OpsPharmacyCard[];
  compliance?: OpsComplianceRow[];
  signature_pending?: OpsSignaturePending[];
  alerts_revive?: OpsAlertRevive[];
  cycle_events?: OpsCycleEventRow[];
};

export type FinancialOperationsHub = {
  period_days: number;
  reference_date?: string | null;
  pharmacy_id?: string | null;
  totals: {
    open_tasks: number;
    overdue_tasks: number;
    open_conversations: number;
    pending_financial: number;
    pending_advances: number;
  };
  tasks: OpsHubTaskRow[];
  conversations: OpsHubConversationRow[];
  notifications: PortfolioAlert[];
  financial_funnel: Record<string, number>;
  kpis?: OpsKpiRow[];
  alerts_revive?: OpsAlertRevive[];
  cycle_events?: OpsCycleEventRow[];
  signature_pending?: OpsSignaturePending[];
};

export type ExecutionBoard = {
  period_days: number;
  reference_date?: string | null;
  pharmacy_id?: string | null;
  kpis: OpsKpiRow[];
  tasks: OpsHubTaskRow[];
  alerts_revive: OpsAlertRevive[];
  signature_pending?: OpsSignaturePending[];
  cycle_events?: OpsCycleEventRow[];
  summary: { open: number; overdue: number; mine: number };
};

export type TaskLaunchContext = {
  manual_task_types: Array<{
    task_type: string;
    label: string;
    icon: string;
    tone: string;
  }>;
  drivers: Array<{ id: string; name: string; phone?: string | null; primary_pharmacy_id?: string | null; leader_linked_pharmacy_ids?: string[] }>;
  pharmacies: Array<{ id: string; trade_name: string; leader_id?: string | null; leader_name?: string | null }>;
  leaders: Array<{ id: string; name: string; pharmacy_ids?: string[] }>;
};

export type CreateTaskKind = string;

export async function fetchPortfolioOperationsHub(
  period = 30,
  opts?: { referenceDate?: string; pharmacyId?: string }
) {
  const { data } = await api.get<PortfolioOperationsHub>('/api/ops-analytics/portfolio/hub', {
    params: buildOpsHubQueryParams({ period, ...opts }),
  });
  return data;
}

export async function fetchFinancialOperationsHub(
  period = 30,
  opts?: { referenceDate?: string; pharmacyId?: string }
) {
  const { data } = await api.get<FinancialOperationsHub>('/api/ops-analytics/financial-hub', {
    params: buildOpsHubQueryParams({ period, ...opts }),
  });
  return data;
}

export async function fetchExecutionBoard(
  board: 'geral' | 'financeiro' = 'geral',
  period = 30,
  opts?: {
    referenceDate?: string;
    pharmacyId?: string;
    taskType?: string;
    status?: string;
    assigneeId?: string;
    dateFrom?: string;
    dateTo?: string;
  }
) {
  const { data } = await api.get<ExecutionBoard>('/api/ops-analytics/execution-board', {
    params: {
      board,
      ...buildOpsHubQueryParams({ period, referenceDate: opts?.referenceDate, pharmacyId: opts?.pharmacyId }),
      task_type: opts?.taskType || undefined,
      status: opts?.status || undefined,
      assignee_id: opts?.assigneeId || undefined,
      date_from: opts?.dateFrom || undefined,
      date_to: opts?.dateTo || undefined,
    },
  });
  return data;
}

export async function fetchTaskLaunchContext(scope: 'ag' | 'portfolio' = 'ag') {
  const { data } = await api.get<TaskLaunchContext>('/api/ops-analytics/tasks/launch-context', {
    params: { scope },
  });
  return data;
}

export type OpsDriverSearchResult = {
  id: string;
  name: string;
  phone?: string | null;
  primary_pharmacy_id?: string | null;
  leader_linked_pharmacy_ids?: string[];
};

export async function fetchOpsDriverSearch(params: {
  q: string;
  scope: 'ag' | 'portfolio';
  leader_id?: string;
}) {
  const { data } = await api.get<{ drivers: OpsDriverSearchResult[] }>(
    '/api/ops-analytics/drivers/search',
    { params }
  );
  return data.drivers;
}

export async function createOperacaoTask(body: {
  task_type: string;
  task_kind?: CreateTaskKind;
  driver_id: string;
  pharmacy_id?: string;
  leader_id?: string | null;
  assignee_id?: string;
  notes?: string;
  last_worked_at?: string;
  operation_started_at?: string;
  reason?: string;
  conversation_id?: string;
  scope?: 'ag' | 'portfolio';
}) {
  const { data } = await api.post<{ task_id: string; deep_link: string; tasks: unknown[] }>(
    '/api/ops-analytics/tasks',
    body
  );
  return data;
}

export async function createOpsPreRegistration(body: {
  on_behalf_of_leader_id: string;
  name: string;
  cpf?: string | null;
  phone: string;
  email?: string | null;
  city?: string | null;
  state?: string | null;
  driver_type: 'fixed' | 'daily';
  work_schedule?: Record<string, unknown>;
  pharmacy_ids: string[];
  primary_pharmacy_id?: string | null;
  notes?: string | null;
}) {
  const { data } = await api.post('/api/ops-analytics/pre-registrations', body);
  return data;
}

export async function createOpsTerminationRequest(body: {
  on_behalf_of_leader_id: string;
  driver_id: string;
  last_worked_at: string;
  reason: string;
  notes?: string | null;
}) {
  const { data } = await api.post('/api/ops-analytics/termination-requests', body);
  return data;
}

export type OperationalKpiDefinition = {
  key: string;
  label: string;
  owner: 'operacao' | 'supervisao' | 'tecnico';
  target: string;
};

export const OPERATIONAL_KPIS_V1: OperationalKpiDefinition[] = [
  { key: 'tickets_opened', label: 'Tickets abertos no período', owner: 'operacao', target: 'visibilidade diária' },
  { key: 'tickets_resolved', label: 'Tickets resolvidos no período', owner: 'operacao', target: '>= 85% do volume aberto' },
  { key: 'sla_on_time_rate', label: 'Cumprimento de SLA', owner: 'supervisao', target: '>= 92%' },
  { key: 'escalation_rate', label: 'Taxa de escalonamento', owner: 'supervisao', target: '<= 15%' },
  { key: 'avg_handle_minutes', label: 'Tempo médio de atendimento', owner: 'operacao', target: '<= 20 min por ticket' },
  { key: 'mcp_error_rate', label: 'Erro de ferramentas MCP', owner: 'tecnico', target: '<= 2%' },
];

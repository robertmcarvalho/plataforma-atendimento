export type McpAction = {
  action: string;
  description: string;
  required_input_fields?: string[];
};

export type McpTool = {
  tool: string;
  title: string;
  description: string;
  priority: 'P0' | 'P1' | 'P2';
  actions: McpAction[];
};

export const MCP_TOOLS: McpTool[] = [
  {
    tool: 'mcp-operacao',
    title: 'Operacao',
    description: 'Contexto operacional de entregador/farmacia/lider.',
    priority: 'P0',
    actions: [
      { action: 'get_driver_context', description: 'Busca contexto operacional do entregador.' },
      { action: 'get_leader_context', description: 'Busca contexto do lider responsavel.' },
      { action: 'get_pharmacy_context', description: 'Busca contexto da farmacia vinculada.' },
      { action: 'get_attendant_scope', description: 'Retorna escopo de atendimento do usuario.' },
      { action: 'list_driver_links_by_pharmacy', description: 'Lista vinculos ativos de entregadores por farmacia.' },
    ],
  },
  {
    tool: 'mcp-routing',
    title: 'Roteamento',
    description: 'Resolucao e explicacao de roteamento.',
    priority: 'P0',
    actions: [
      { action: 'resolve_target_sector', description: 'Resolve setor alvo da conversa.', required_input_fields: ['conversation_id'] },
      { action: 'resolve_best_attendant', description: 'Escolhe melhor atendente para o caso.' },
      { action: 'explain_routing_decision', description: 'Explica a decisao de roteamento.', required_input_fields: ['conversation_id'] },
    ],
  },
  {
    tool: 'mcp-tasking',
    title: 'Pendencias',
    description: 'Gestao de tarefas operacionais.',
    priority: 'P0',
    actions: [
      { action: 'create_pending_task', description: 'Cria pendencia operacional.', required_input_fields: ['title'] },
      { action: 'list_pending_tasks', description: 'Lista pendencias abertas.' },
      { action: 'assign_task', description: 'Atribui pendencia para usuario.', required_input_fields: ['task_id', 'assignee_id'] },
      { action: 'close_task', description: 'Conclui pendencia.', required_input_fields: ['task_id'] },
    ],
  },
  {
    tool: 'mcp-audit',
    title: 'Auditoria',
    description: 'Registro de trilha operacional e execucao.',
    priority: 'P0',
    actions: [
      { action: 'append_timeline_event', description: 'Adiciona evento na timeline operacional.', required_input_fields: ['event_type'] },
      { action: 'log_flow_decision', description: 'Registra decisao de fluxo.' },
      { action: 'log_tool_execution', description: 'Registra execucao de ferramenta MCP.' },
    ],
  },
  {
    tool: 'mcp-finance',
    title: 'Financeiro',
    description: 'Contexto e operacoes financeiras por tenant.',
    priority: 'P1',
    actions: [
      { action: 'get_tenant_financial_snapshot', description: 'Retorna snapshot financeiro agregado do tenant.', required_input_fields: ['tenant_id'] },
      { action: 'list_tenant_overdue_items', description: 'Lista itens em atraso do tenant.' },
      { action: 'get_tenant_reconciliation_status', description: 'Retorna status de conciliacao financeira do tenant.', required_input_fields: ['tenant_id'] },
    ],
  },
  {
    tool: 'mcp-integrations',
    title: 'Integrações',
    description: 'Conectores externos por tenant (ERP/CRM).',
    priority: 'P2',
    actions: [
      { action: 'erp_orders_get_status', description: 'Consulta status de pedido no conector ERP logístico.', required_input_fields: ['connector_id', 'order_id'] },
      { action: 'erp_orders_list_recent', description: 'Lista pedidos recentes do tenant no ERP logístico.' },
      { action: 'connector_health_check', description: 'Valida saúde do conector externo por tenant.', required_input_fields: ['connector_id'] },
    ],
  },
];

export function getToolCatalog(): McpTool[] {
  return MCP_TOOLS;
}

export function isValidToolAction(tool: string, action: string): boolean {
  const t = MCP_TOOLS.find((item) => item.tool === tool);
  if (!t) return false;
  return t.actions.some((entry) => entry.action === action);
}

export function getMcpActionMeta(tool: string, action: string): McpAction | null {
  const t = MCP_TOOLS.find((item) => item.tool === tool);
  if (!t) return null;
  return t.actions.find((entry) => entry.action === action) || null;
}

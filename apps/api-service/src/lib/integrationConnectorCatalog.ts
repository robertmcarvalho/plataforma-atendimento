export type ConnectorDomain = 'erp' | 'crm' | 'finance';
export type DeliveryModel = 'api' | 'file' | 'webhook' | 'hybrid';

export type ConnectorCatalogItem = {
  id: string;
  name: string;
  domain: ConnectorDomain;
  delivery_model: DeliveryModel;
  demand_score: number; // 1-5
  implementation_effort: number; // 1-5 (higher = harder)
  strategic_value: number; // 1-5
  notes: string;
};

export const CONNECTOR_CATALOG_V1: ConnectorCatalogItem[] = [
  {
    id: 'finance-erp-payables',
    name: 'ERP Financeiro (contas a pagar/receber)',
    domain: 'finance',
    delivery_model: 'api',
    demand_score: 5,
    implementation_effort: 3,
    strategic_value: 5,
    notes: 'Maior impacto para contexto financeiro e SLA de pagamentos.',
  },
  {
    id: 'crm-customer-360',
    name: 'CRM (histórico e perfil 360)',
    domain: 'crm',
    delivery_model: 'api',
    demand_score: 4,
    implementation_effort: 3,
    strategic_value: 5,
    notes: 'Melhora roteamento e personalização no atendimento.',
  },
  {
    id: 'erp-orders-logistics',
    name: 'ERP Logístico (pedidos/entregas)',
    domain: 'erp',
    delivery_model: 'api',
    demand_score: 4,
    implementation_effort: 4,
    strategic_value: 4,
    notes: 'Importante para operação de entregadores e farmácias.',
  },
  {
    id: 'finance-bank-reconciliation',
    name: 'Conciliação bancária',
    domain: 'finance',
    delivery_model: 'hybrid',
    demand_score: 3,
    implementation_effort: 4,
    strategic_value: 4,
    notes: 'Ajuda auditoria e contestação, porém com integração mais complexa.',
  },
  {
    id: 'crm-marketing-automation',
    name: 'CRM Marketing (campanhas/segmentação)',
    domain: 'crm',
    delivery_model: 'api',
    demand_score: 3,
    implementation_effort: 2,
    strategic_value: 3,
    notes: 'Valor adicional para campanhas, menor urgência operacional.',
  },
];

export function connectorPriorityScore(item: ConnectorCatalogItem): number {
  // Valor e demanda pesam mais que esforço (esforço reduz prioridade).
  return item.demand_score * 0.45 + item.strategic_value * 0.45 - item.implementation_effort * 0.25;
}

export function listPrioritizedConnectors() {
  return CONNECTOR_CATALOG_V1.map((item) => ({
    ...item,
    priority_score: Number(connectorPriorityScore(item).toFixed(2)),
  })).sort((a, b) => b.priority_score - a.priority_score);
}

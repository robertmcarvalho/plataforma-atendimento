export type DefaultExpenseTypeSeed = {
  name: string;
  kind: 'fixed' | 'variable';
  default_entity: 'coop' | 'flux' | 'both';
  allocation_mode?: 'none' | 'per_pharmacy' | 'per_driver' | 'per_delivery' | 'per_provider';
  recurrence?: string | null;
  affects_dre?: boolean;
  management_group?: 'operational' | 'administrative' | 'financial' | 'tax' | 'commercial' | 'patrimonial' | 'outside_dre';
  dre_group?: 'operational_cost' | 'administrative_expense' | 'financial_expense' | 'tax' | 'commercial_expense' | 'outside_dre';
  allocation_policy?: 'direct_cost_center' | 'revenue_share' | 'driver_share' | 'delivery_share' | 'manual' | 'none';
  requires_cost_center?: boolean;
};

export const DEFAULT_BILLING_EXPENSE_TYPES: DefaultExpenseTypeSeed[] = [
  { name: 'Aluguel', kind: 'fixed', default_entity: 'both', recurrence: 'monthly', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'direct_cost_center', requires_cost_center: true },
  { name: 'Auxílio transporte', kind: 'variable', default_entity: 'coop', management_group: 'operational', dre_group: 'operational_cost', allocation_policy: 'driver_share' },
  { name: 'Auxílio combustível', kind: 'variable', default_entity: 'both', allocation_mode: 'per_driver', management_group: 'operational', dre_group: 'operational_cost', allocation_policy: 'driver_share' },
  { name: 'Reembolso', kind: 'variable', default_entity: 'both', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'direct_cost_center' },
  { name: 'Mensalidade convênio médico', kind: 'fixed', default_entity: 'coop', recurrence: 'monthly', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'driver_share' },
  { name: 'Coparticipação convênio médico', kind: 'variable', default_entity: 'coop', allocation_mode: 'per_driver', management_group: 'operational', dre_group: 'operational_cost', allocation_policy: 'driver_share' },
  { name: 'Apoio de caixa', kind: 'variable', default_entity: 'both', management_group: 'operational', dre_group: 'operational_cost', allocation_policy: 'direct_cost_center' },
  { name: 'Viagens', kind: 'variable', default_entity: 'both', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'direct_cost_center' },
  { name: 'Eventos', kind: 'variable', default_entity: 'flux', management_group: 'commercial', dre_group: 'commercial_expense', allocation_policy: 'direct_cost_center' },
  { name: 'Transferências', kind: 'variable', default_entity: 'both', affects_dre: false, management_group: 'outside_dre', dre_group: 'outside_dre', allocation_policy: 'none' },
  { name: 'Bônus de produtividade', kind: 'variable', default_entity: 'both', management_group: 'operational', dre_group: 'operational_cost', allocation_policy: 'driver_share' },
  { name: 'Retirada / participação nos lucros', kind: 'variable', default_entity: 'coop', affects_dre: false, management_group: 'outside_dre', dre_group: 'outside_dre', allocation_policy: 'none' },
  { name: 'Alimentação / refeição', kind: 'variable', default_entity: 'both', management_group: 'operational', dre_group: 'operational_cost', allocation_policy: 'driver_share' },
  { name: 'Uniforme / bag / equipamentos', kind: 'variable', default_entity: 'both', allocation_mode: 'per_driver', management_group: 'operational', dre_group: 'operational_cost', allocation_policy: 'driver_share' },
  { name: 'Software / sistemas / licenças', kind: 'fixed', default_entity: 'both', recurrence: 'monthly', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'revenue_share' },
  { name: 'Telefonia / internet', kind: 'fixed', default_entity: 'both', recurrence: 'monthly', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'revenue_share' },
  { name: 'Contabilidade', kind: 'fixed', default_entity: 'both', recurrence: 'monthly', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'direct_cost_center', requires_cost_center: true },
  { name: 'Jurídico', kind: 'variable', default_entity: 'both', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'direct_cost_center' },
  { name: 'Tarifas bancárias / IOF / juros', kind: 'variable', default_entity: 'both', management_group: 'financial', dre_group: 'financial_expense', allocation_policy: 'direct_cost_center' },
  { name: 'Impostos / taxas', kind: 'variable', default_entity: 'both', management_group: 'tax', dre_group: 'tax', allocation_policy: 'direct_cost_center' },
  { name: 'Material de escritório', kind: 'variable', default_entity: 'both', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'direct_cost_center' },
  { name: 'Manutenção / reparos', kind: 'variable', default_entity: 'both', management_group: 'operational', dre_group: 'operational_cost', allocation_policy: 'direct_cost_center' },
  { name: 'Seguro', kind: 'fixed', default_entity: 'both', recurrence: 'monthly', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'direct_cost_center' },
  { name: 'Limpeza / condomínio / energia / água', kind: 'fixed', default_entity: 'both', recurrence: 'monthly', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'direct_cost_center' },
  { name: 'Publicidade / propaganda', kind: 'variable', default_entity: 'flux', management_group: 'commercial', dre_group: 'commercial_expense', allocation_policy: 'direct_cost_center' },
  { name: 'Comissões / indicações', kind: 'variable', default_entity: 'both', management_group: 'commercial', dre_group: 'commercial_expense', allocation_policy: 'revenue_share' },
  { name: 'Pagamento de funcionários / folha administrativa', kind: 'fixed', default_entity: 'flux', recurrence: 'monthly', management_group: 'administrative', dre_group: 'administrative_expense', allocation_policy: 'direct_cost_center', requires_cost_center: true },
];

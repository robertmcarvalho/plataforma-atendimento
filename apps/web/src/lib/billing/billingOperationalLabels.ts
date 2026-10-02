/** Rótulos operacionais (pt-BR) para telas de faturamento — evitar jargão técnico/inglês na UI. */

export const OFFBOARDING_PREVIEW_STATUS_LABEL: Record<string, string> = {
  preview: 'Em conferência',
  payable_generated: 'Pagamento gerado',
  cancelled: 'Cancelada',
};

export const QUOTA_LEDGER_ENTRY_TYPE_LABEL: Record<string, string> = {
  integralization: 'Integralização (parcela paga)',
  adjustment: 'Ajuste manual',
  reversal: 'Estorno',
  compensation: 'Compensação no acerto',
  refund: 'Devolução no desligamento',
};

export const FINANCIAL_LEDGER_ENTRY_TYPE_LABEL: Record<string, string> = {
  advance_recovery: 'Recuperação de adiantamento',
  uniform_recovery: 'Recuperação de uniforme',
  bag_recovery: 'Recuperação de bag/mochila',
  digital_cert_recovery: 'Recuperação de certificado digital',
  other_financial_recovery: 'Outra recuperação financeira',
};

export const CAPITAL_COOP_SOURCE_LABEL: Record<string, string> = {
  quota_account: 'Conta de cotas',
  financial_ledger: 'Financeiro cooperativo',
};

export const QUOTA_DECISION_LABEL: Record<string, string> = {
  waived: 'Cobrança cancelada',
  kept: 'Mantida em aberto',
  compensated: 'Compensada no acerto',
};

export const OFFBOARDING_LINE_KIND_LABEL: Record<string, string> = {
  open_cycle_settlement: 'Acerto de ciclo aberto',
  daily: 'Diária aprovada',
  quota_refund: 'Restituição de cotas integralizadas',
  quota_pending: 'Cota pendente',
  absence: 'Falta / desconto',
  advance: 'Adiantamento',
  uniform: 'Uniforme',
  bag: 'Bag / mochila',
  existing_payable: 'Pagamento já lançado',
};

export const DELIVERY_SOURCE_OPERATIONAL_LABEL: Record<string, string> = {
  flux_api: 'Importação Flux',
  flux_db: 'Banco Flux',
  manual: 'Lançamento manual',
  csv: 'Planilha CSV',
  external_app: 'Planilha Excel',
};

const OFFBOARDING_WARNING_PT: Record<string, string> = {
  'Existe ciclo aberto no período; confirme se Flux API/MySQL/ATIVMOB foram sincronizados antes da liberação.':
    'Há ciclo de apuração em aberto neste período. Antes de liberar o pagamento, confira se todas as entregas já foram importadas (Flux, planilha ou lançamento manual).',
  'Acertos de ciclo recalculados sem desconto de cota; as cotas integralizadas serão restituídas neste desligamento.':
    'O acerto do ciclo foi recalculado sem descontar cota, pois as cotas já pagas serão restituídas neste desligamento.',
  'Cotas integralizadas serão restituídas; descontos de cota no ciclo e no financeiro foram neutralizados nesta prévia.':
    'As cotas já pagas pelo cooperado serão devolvidas. Descontos de cota no ciclo e no financeiro foram neutralizados nesta prévia.',
  'Há parcelas de cota em aberto. Na aba Pendências, defina o que fazer com cada uma: cancelar cobrança, compensar no acerto ou manter pendente.':
    'Há parcelas de cota em aberto. Na aba Pendências, defina o que fazer com cada uma: cancelar cobrança, compensar no acerto ou manter pendente.',
  'Há ciclo de apuração em aberto neste período. Antes de liberar o pagamento, confira se todas as entregas já foram importadas (Flux, planilha ou lançamento manual).':
    'Há ciclo de apuração em aberto neste período. Antes de liberar o pagamento, confira se todas as entregas já foram importadas (Flux, planilha ou lançamento manual).',
  'Já existem pagamentos em aberto para este entregador. Evite gerar um pagamento duplicado no acerto final.':
    'Já existem pagamentos em aberto para este entregador. Evite gerar um pagamento duplicado no acerto final.',
  'Há APs abertos para este entregador; evite pagamento duplicado no acerto final.':
    'Já existem pagamentos em aberto para este entregador. Evite gerar um pagamento duplicado no acerto final.',
  'CPF ausente para pagamento/relatórios.': 'CPF não cadastrado — necessário para pagamento e relatórios.',
  'Chave PIX ausente para geração do C6.': 'Chave PIX não cadastrada — necessária para gerar o arquivo de pagamento.',
};

export function offboardingPreviewStatusLabel(status?: string | null): string {
  if (!status) return '—';
  return OFFBOARDING_PREVIEW_STATUS_LABEL[status] || status;
}

export function quotaLedgerEntryTypeLabel(type?: string | null): string {
  if (!type) return '—';
  return QUOTA_LEDGER_ENTRY_TYPE_LABEL[type] || type;
}

export function financialLedgerEntryTypeLabel(type?: string | null): string {
  if (!type) return '—';
  return FINANCIAL_LEDGER_ENTRY_TYPE_LABEL[type] || type;
}

export function capitalCoopSourceLabel(source?: string | null): string {
  if (!source) return '—';
  return CAPITAL_COOP_SOURCE_LABEL[source] || source;
}

export function capitalCoopMovementTypeLabel(source?: string | null, entryType?: string | null): string {
  if (source === 'financial_ledger') return financialLedgerEntryTypeLabel(entryType);
  return quotaLedgerEntryTypeLabel(entryType);
}

export function quotaDecisionLabel(decision?: string | null): string {
  if (!decision) return 'Aguardando decisão';
  return QUOTA_DECISION_LABEL[decision] || decision;
}

export function offboardingLineKindLabel(kind?: string | null): string {
  if (!kind) return '—';
  return OFFBOARDING_LINE_KIND_LABEL[kind] || kind;
}

export function deliverySourceOperationalLabel(source?: string | null): string {
  if (!source) return '—';
  return DELIVERY_SOURCE_OPERATIONAL_LABEL[source] || source;
}

/** Converte avisos legados (inglês/técnicos) para linguagem operacional. */
export function humanizeOffboardingWarning(message: string): string {
  const trimmed = message.trim();
  if (OFFBOARDING_WARNING_PT[trimmed]) return OFFBOARDING_WARNING_PT[trimmed];
  return trimmed
    .replace(/Flux API\/MySQL\/ATIVMOB/gi, 'importação de entregas (Flux, planilha ou manual)')
    .replace(/\bledger\b/gi, 'extrato da conta')
    .replace(/\bpayable_generated\b/gi, 'pagamento gerado')
    .replace(/\bpreview\b/gi, 'em conferência');
}

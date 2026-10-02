export const BILLING_ENTITY_LABEL: Record<string, string> = {
  coop: 'CoopMob',
  flux: 'Flux Farma',
  both: 'CoopMob + Flux Farma',
};

export const BILLING_STATUS_LABEL: Record<string, string> = {
  draft: 'Rascunho',
  open: 'Aberto',
  in_review: 'Em conferência',
  approved: 'Aprovado',
  sent: 'Enviado',
  paid: 'Pago',
  cancelled: 'Cancelado',
  closed: 'Fechado',
  resolved: 'Resolvido',
};

export const BILLING_NFSE_STATUS_LABEL: Record<string, string> = {
  pending: 'NF pendente',
  authorized: 'NF autorizada',
  rejected: 'NF rejeitada',
  canceled: 'NF cancelada',
};

export const BILLING_PAYMENT_METHOD_LABEL: Record<string, string> = {
  pix: 'PIX',
  transfer: 'Transferência',
  credit_card: 'Cartão de crédito',
  cash: 'Dinheiro',
  other: 'Outro',
};

export const BILLING_BENEFICIARY_LABEL: Record<string, string> = {
  driver: 'Entregador',
  supplier: 'Fornecedor',
  operational: 'Operacional',
  internal_provider: 'Prestador',
  shareholder: 'Sócio',
  commercial_partner: 'Parceiro comercial',
  leader: 'Líder',
};

export function billingStatusLabel(status?: string | null): string {
  return status ? BILLING_STATUS_LABEL[status] || status : '—';
}

export function billingNfseStatusLabel(status?: string | null): string {
  return status ? BILLING_NFSE_STATUS_LABEL[status] || status : '—';
}

export function billingEntityLabel(entity?: string | null): string {
  return entity ? BILLING_ENTITY_LABEL[entity] || entity : '—';
}

export function billingPaymentMethodLabel(method?: string | null): string {
  return method ? BILLING_PAYMENT_METHOD_LABEL[method] || method : '—';
}

export function billingBeneficiaryLabel(type?: string | null): string {
  return type ? BILLING_BENEFICIARY_LABEL[type] || type : '—';
}

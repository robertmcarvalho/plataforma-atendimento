const ALERTA_TIPO_LABELS: Record<string, string> = {
  task_overdue: 'Prazo estourado',
  signature_pending: 'Assinatura pendente',
  settlement_overdue: 'Acerto atrasado',
  awaiting_signature: 'Aguardando assinatura',
  awaiting_settlement: 'Acerto pendente',
  settlement_pending: 'Acerto pendente',
  advance_backlog: 'Adiantamentos pendentes',
  sla: 'SLA',
  doc_alert: 'Documentação',
  absence_coverage: 'Cobertura de falta',
};

export function alertaTipoLabel(tipo: string): string {
  const key = String(tipo || '').trim().toLowerCase();
  if (!key) return 'Alerta';
  return ALERTA_TIPO_LABELS[key] || key.replace(/_/g, ' ');
}

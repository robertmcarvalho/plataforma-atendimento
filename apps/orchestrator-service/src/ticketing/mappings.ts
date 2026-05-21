export type TicketClassification = {
  type: 'payment' | 'contestation' | 'app' | 'question' | 'advance';
  priority: 'high' | 'medium' | 'normal' | 'bot';
  sla_minutes: 120 | 240 | 480 | 1440;
};

const KEYWORDS: Array<{ terms: string[]; classification: TicketClassification }> = [
  {
    terms: ['pagamento', 'pix', 'nao caiu', 'cade meu dinheiro'],
    classification: { type: 'payment', priority: 'high', sla_minutes: 120 },
  },
  {
    terms: ['desconto errado', 'contestar', 'nao faltei', 'injusto'],
    classification: { type: 'contestation', priority: 'medium', sla_minutes: 240 },
  },
  {
    terms: ['app travou', 'bug', 'nao abre', 'erro'],
    classification: { type: 'app', priority: 'normal', sla_minutes: 480 },
  },
  {
    terms: ['quanto vou receber', 'meu extrato', 'quando paga'],
    classification: { type: 'question', priority: 'bot', sla_minutes: 1440 },
  },
];

export function classifyInboundText(text: string): TicketClassification {
  const normalized = String(text || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  for (const row of KEYWORDS) {
    if (row.terms.some((term) => normalized.includes(term))) return row.classification;
  }

  return { type: 'advance', priority: 'normal', sla_minutes: 480 };
}

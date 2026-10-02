export const DEFAULT_PIPELINE_STAGES = [
  { name: 'Novo lead', color: '#6366f1', sort_order: 0, probability_pct: 5, is_entry: true, is_won: false, is_lost: false },
  { name: 'Contato', color: '#8b5cf6', sort_order: 1, probability_pct: 10, is_entry: false, is_won: false, is_lost: false },
  { name: 'Qualificação', color: '#a855f7', sort_order: 2, probability_pct: 20, is_entry: false, is_won: false, is_lost: false },
  { name: 'Reunião', color: '#d946ef', sort_order: 3, probability_pct: 35, is_entry: false, is_won: false, is_lost: false },
  { name: 'Diagnóstico', color: '#ec4899', sort_order: 4, probability_pct: 45, is_entry: false, is_won: false, is_lost: false },
  { name: 'Proposta', color: '#f97316', sort_order: 5, probability_pct: 60, is_entry: false, is_won: false, is_lost: false },
  { name: 'Negociação', color: '#eab308', sort_order: 6, probability_pct: 75, is_entry: false, is_won: false, is_lost: false },
  { name: 'Contrato', color: '#22c55e', sort_order: 7, probability_pct: 90, is_entry: false, is_won: false, is_lost: false },
  { name: 'Ganho', color: '#16a34a', sort_order: 8, probability_pct: 100, is_entry: false, is_won: true, is_lost: false },
  { name: 'Perdido', color: '#64748b', sort_order: 9, probability_pct: 0, is_entry: false, is_won: false, is_lost: true },
] as const;

export const DEFAULT_LOSS_REASONS = [
  { name: 'Preço / margem', sort_order: 0 },
  { name: 'Timing — não é prioridade agora', sort_order: 1 },
  { name: 'Fechou com concorrente', sort_order: 2 },
  { name: 'Inviabilidade operacional', sort_order: 3 },
  { name: 'Sem retorno', sort_order: 4 },
] as const;

export const DEFAULT_ERP_OPTIONS = [
  { name: 'Trier', sort_order: 0 },
  { name: 'Softpharma', sort_order: 1 },
  { name: 'Pharmasystem', sort_order: 2 },
  { name: 'Outro', sort_order: 3 },
] as const;

export const DEFAULT_FIELD_DEFINITIONS = [
  { slug: 'horario_pico', label: 'Horário de pico', field_type: 'text', required: false, options: [], sort_order: 0 },
  { slug: 'franquia', label: 'Rede / franquia', field_type: 'text', required: false, options: [], sort_order: 1 },
] as const;

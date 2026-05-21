/** Mapa das etapas do intake guiado → chaves de mensagem no catálogo. */
export type IntakeStepId =
  | 'out_of_hours'
  | 'welcome'
  | 'profile'
  | 'sector'
  | 'demand'
  | 'pharmacy'
  | 'collect_name'
  | 'collect_city'
  | 'handoff';

export type IntakeStepDef = {
  id: IntakeStepId;
  order: number;
  title: string;
  description: string;
  messageKeys: Array<{ key: string; label: string; optional?: boolean }>;
  catalogTab?: 'messages' | 'profiles' | 'sectors' | 'channels' | 'sla' | 'out_of_hours';
};

export const INTAKE_JOURNEY_STEPS: IntakeStepDef[] = [
  {
    id: 'out_of_hours',
    order: 0,
    title: 'Fora do horário',
    description: 'Resposta automática antes do intake quando o canal está fora do horário configurado no webhook.',
    messageKeys: [{ key: 'messages.out_of_hours', label: 'Mensagem fora do horário' }],
    catalogTab: 'channels',
  },
  {
    id: 'welcome',
    order: 1,
    title: 'Boas-vindas',
    description: 'Primeira mensagem e convite a escolher o tipo de atendimento.',
    messageKeys: [
      { key: 'driver_greeting_list', label: 'Lista de setores (entregador)' },
      { key: 'unknown_ask_driver', label: 'Pergunta se é entregador', optional: true },
    ],
    catalogTab: 'messages',
  },
  {
    id: 'profile',
    order: 2,
    title: 'Perfil de atendimento',
    description: 'Entregador, farmácia ou líder — definido nos perfis aceitos do webhook.',
    messageKeys: [],
    catalogTab: 'channels',
  },
  {
    id: 'sector',
    order: 3,
    title: 'Setor',
    description: 'Setores visíveis no intake conforme configuração do webhook.',
    messageKeys: [{ key: 'ask_intent_invalid', label: 'Opção inválida (setor)', optional: true }],
    catalogTab: 'channels',
  },
  {
    id: 'demand',
    order: 4,
    title: 'Demanda',
    description: 'Motivo do contato dentro do setor escolhido — configurado no webhook do canal.',
    messageKeys: [],
    catalogTab: 'channels',
  },
  {
    id: 'pharmacy',
    order: 5,
    title: 'Farmácia (quando aplicável)',
    description: 'Vínculo de farmácia para perfil entregador quando a demanda do webhook exigir contexto.',
    messageKeys: [
      { key: 'ask_pharmacy_numbered', label: 'Escolha farmácia (numerada)', optional: true },
      { key: 'ask_pharmacy', label: 'Escolha farmácia', optional: true },
      { key: 'leader_ask_pharmacy_numbered', label: 'Líder — farmácia numerada', optional: true },
    ],
    catalogTab: 'channels',
  },
  {
    id: 'collect_name',
    order: 6,
    title: 'Coleta — nome',
    description: 'Identificação do contato no cadastro.',
    messageKeys: [
      { key: 'ask_driver_name', label: 'Pergunta nome completo' },
      { key: 'ask_driver_name_retry', label: 'Retry nome', optional: true },
    ],
    catalogTab: 'messages',
  },
  {
    id: 'collect_city',
    order: 7,
    title: 'Coleta — cidade',
    description: 'Cidade de atuação do entregador.',
    messageKeys: [
      { key: 'ask_driver_city', label: 'Pergunta cidade' },
      { key: 'ask_driver_city_retry', label: 'Retry cidade', optional: true },
    ],
    catalogTab: 'messages',
  },
  {
    id: 'handoff',
    order: 8,
    title: 'Handoff + SLA',
    description: 'Aplica SLA da demanda e encaminha para fila/atendente.',
    messageKeys: [],
    catalogTab: 'sla',
  },
];

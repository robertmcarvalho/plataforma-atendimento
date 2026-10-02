import { DEFAULT_OUT_OF_HOURS_MESSAGE } from '@plataforma/channel-runtime';
import { novoBloco, type Bloco, type BlocoTipo } from '@/lib/conversation-flow/fluxo';
import type { SetoresPorPerfilPools } from '@/lib/conversation-flow/triagemPorPerfilPreset';
import type { ChannelOperationalCatalog } from '@/lib/integrations/useSectorsFromMessagingWebhooks';

type PresetOptions = {
  catalog?: ChannelOperationalCatalog | null;
  setoresPorPerfil?: SetoresPorPerfilPools;
};

const make = (tipo: BlocoTipo, configOverrides: Record<string, unknown> = {}, collapsed = true): Bloco => {
  const b = novoBloco(tipo);
  return { ...b, config: { ...b.config, ...configOverrides }, collapsed };
};

function firstChannel(catalog?: ChannelOperationalCatalog | null) {
  return catalog?.channels?.[0]?.config || null;
}

function firstQueueName(catalog?: ChannelOperationalCatalog | null) {
  const config = firstChannel(catalog);
  return config?.routing.default_queue_name || config?.queues?.[0]?.name || '';
}

function firstManagerId(catalog?: ChannelOperationalCatalog | null) {
  const config = firstChannel(catalog);
  return config?.sectors.find((s) => s.escalation_manager_id)?.escalation_manager_id || '';
}

function demandTitlesForProfile(
  catalog: ChannelOperationalCatalog | null | undefined,
  sectorIds: string[],
  fallback: string[]
): string[] {
  const ids = new Set(sectorIds);
  const titles =
    catalog?.demands
      ?.filter((d) => d.is_active !== false && (!ids.size || d.sector_ids.some((id) => ids.has(id))))
      .map((d) => d.title)
      .filter(Boolean) || [];
  return titles.length ? Array.from(new Set(titles)) : fallback;
}

export function buildTriagemPerfilAutomationPreset(options?: PresetOptions): Bloco[] {
  const pools = options?.setoresPorPerfil || {
    entregador: ['operacao', 'financeiro', 'suporte'],
    farmacia: ['comercial', 'operacao', 'financeiro', 'suporte'],
    lider: ['operacao', 'rh'],
  };
  const demandasEntregador = demandTitlesForProfile(options?.catalog, pools.entregador, [
    'Pagamento / Repasse',
    'Problema na rota',
    'Suporte ao app',
  ]);
  const demandasFarmacia = demandTitlesForProfile(options?.catalog, pools.farmacia, [
    'Novo pedido',
    'Status de entrega',
    'Faturamento / NF',
  ]);

  const identify = make('identificar', { origem: 'telefone' }, false);

  identify.ramos = identify.ramos || {};
  identify.ramos['Encontrado · Entregador'] = [
    make('selecionar-setor', { modo: 'menu', setoresIds: [...pools.entregador] }),
    make('selecionar-demanda', { perfil: 'entregador', demandas: demandasEntregador }),
    make('atribuir-fila', { dinamica: true }),
  ];
  identify.ramos['Encontrado · Farmácia'] = [
    make('selecionar-setor', { modo: 'menu', setoresIds: [...pools.farmacia] }),
    make('selecionar-demanda', { perfil: 'farmacia', demandas: demandasFarmacia }),
    make('atribuir-fila', { dinamica: true }),
  ];
  identify.ramos['Encontrado · Líder'] = [
    make('selecionar-setor', { modo: 'menu', setoresIds: [...pools.lider] }),
    make('atribuir-fila', { dinamica: true }),
  ];
  const unknownProfileChoice = make(
    'escolha-perfil',
    { titulo: 'Perfil', instrucao: 'Escolha Entregador, Farmácia ou Líder.' },
    false
  );
  unknownProfileChoice.ramos = {
    Entregador: [
      make('pergunta', { rotulo: 'Qual seu nome completo?', variavel: 'nome', obrigatorio: true }),
      make('pergunta', { rotulo: 'Em qual cidade você atua?', variavel: 'cidade', obrigatorio: true }),
      make('menu-farmacias', { variavelCidade: 'cidade' }),
      make('criar-precadastro', { tipo: 'entregador', camposExtras: 'cnh, placa' }),
      make('aplicar-tag', { tag: 'cadastro pendente' }),
      make('notificar-atendente', {
        canal: 'painel',
        mensagem: 'Novo pré-cadastro de entregador aguardando validação',
      }),
      make('selecionar-setor', { modo: 'menu', setoresIds: [...pools.entregador] }),
      make('selecionar-demanda', { perfil: 'entregador', demandas: demandasEntregador }),
      make('atribuir-fila', { dinamica: true }),
    ],
    Farmácia: [
      make('pergunta', { rotulo: '(Farmácia) Qual a razão social?', variavel: 'razao_social', obrigatorio: true }),
      make('pergunta', {
        rotulo: '(Farmácia) Qual seu perfil? Gestor / Expedição / Financeiro',
        variavel: 'perfil_farmacia',
        obrigatorio: true,
      }),
      make('pergunta', { rotulo: '(Farmácia) Qual seu nome?', variavel: 'nome', obrigatorio: true }),
      make('pergunta', { rotulo: '(Farmácia) Qual seu e-mail?', variavel: 'email', obrigatorio: true }),
      make('criar-precadastro', { tipo: 'farmacia', camposExtras: 'cnpj, telefone' }),
      make('aplicar-tag', { tag: 'cadastro pendente' }),
      make('notificar-atendente', {
        canal: 'painel',
        mensagem: 'Novo pré-cadastro de farmácia aguardando validação',
      }),
      make('selecionar-setor', { modo: 'menu', setoresIds: [...pools.farmacia] }),
      make('selecionar-demanda', { perfil: 'farmacia', demandas: demandasFarmacia }),
      make('atribuir-fila', { dinamica: true }),
    ],
    Líder: [],
    'Não entendi': [],
  };
  identify.ramos['Não encontrado'] = [
    make('enviar-mensagem', {
      texto: 'Olá! Não encontrei seu cadastro. Vou te ajudar a abrir um pré-cadastro rapidinho.',
      delaySeg: 0,
    }),
    unknownProfileChoice,
  ];

  return [identify];
}

export function buildEscalacaoPorSlaPreset(options?: PresetOptions): Bloco[] {
  const config = firstChannel(options?.catalog);
  const sla = config?.sla;
  const queueName = firstQueueName(options?.catalog) || 'supervisao';
  const managerId = firstManagerId(options?.catalog);
  const tags = config?.operation.tags || [];
  const slaTag = tags.find((tag) => tag.toLowerCase().includes('sla')) || 'sla estourado';

  const slaEtapa = make(
    'sla-etapa',
    {
      tempoMin: Math.max(1, Math.round((sla?.first_response_sla_minutes || 25) * 0.2)),
      acaoEstouro: 'notificar',
    },
    false
  );
  const notificar = make('notificar-atendente', {
    canal: 'painel',
    mensagem: 'Atendimento próximo do SLA — verifique imediatamente',
  });
  const slaFila = make('sla-fila', {
    tempoMin: sla?.resolution_sla_minutes || 240,
    acaoEstouro: 'escalar',
  });
  const tag = make('aplicar-tag', { tag: slaTag });
  const escalar = make('escalar-gestor', { gestorId: managerId || '', canal: 'email' });
  const reatribuir = make('atribuir-fila', { filaId: queueName, dinamica: false });
  const mensagemCliente = make('enviar-mensagem', {
    texto: 'Pedimos desculpas pela demora. Sua solicitação foi priorizada e um supervisor já está acompanhando.',
    delaySeg: 0,
  });

  return [slaEtapa, notificar, slaFila, tag, escalar, reatribuir, mensagemCliente];
}

export function buildForaHorarioPreset(options?: PresetOptions): Bloco[] {
  const config = firstChannel(options?.catalog);
  const message = config?.messages.out_of_hours || DEFAULT_OUT_OF_HOURS_MESSAGE;
  const queueName = firstQueueName(options?.catalog) || 'retorno-proximo-turno';
  const tags = config?.operation.tags || [];
  const oohTag = tags.find((tag) => tag.toLowerCase().includes('hor')) || 'fora do horário';
  const managerId = firstManagerId(options?.catalog);

  const aviso = make('enviar-mensagem', { texto: message, delaySeg: 0 }, false);
  const urgente = make('pergunta', { rotulo: 'É uma urgência? (sim/não)', variavel: 'urgente', obrigatorio: true });
  const nome = make('pergunta', { rotulo: 'Qual seu nome?', variavel: 'nome', obrigatorio: true });
  const telefone = make('pergunta', {
    rotulo: 'Qual o melhor telefone para retorno?',
    variavel: 'telefone',
    obrigatorio: true,
  });
  const descricao = make('pergunta', {
    rotulo: 'Descreva brevemente sua solicitação',
    variavel: 'descricao',
    obrigatorio: true,
  });
  const tag = make('aplicar-tag', { tag: oohTag });
  const notificarPlantao = make('notificar-atendente', {
    canal: 'email',
    mensagem: 'Mensagem recebida fora do horário — verificar urgência',
  });
  const escalar = make('escalar-gestor', { gestorId: managerId || '', canal: 'whatsapp' });
  const fila = make('atribuir-fila', { filaId: queueName, dinamica: false });
  const confirmacao = make('enviar-mensagem', {
    texto: 'Obrigado! Registramos seu contato e retornaremos assim que possível.',
    delaySeg: 0,
  });

  return [aviso, urgente, nome, telefone, descricao, tag, notificarPlantao, escalar, fila, confirmacao];
}

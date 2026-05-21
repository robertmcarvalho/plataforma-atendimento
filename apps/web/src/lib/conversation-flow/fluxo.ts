// Types and helpers for the inline (nested) flow editor used in
// project-revive-main AutomacaoNova step 3 ("Fluxo de atendimento").

export type BlocoTipo =
  | 'identificar'
  | 'escolha-perfil'
  | 'selecionar-setor'
  | 'selecionar-demanda'
  | 'pergunta'
  | 'menu-farmacias'
  | 'enviar-mensagem'
  | 'script-bot'
  | 'ia-resposta'
  | 'criar-precadastro'
  | 'aplicar-tag'
  | 'notificar-atendente'
  | 'atribuir-fila'
  | 'sla-etapa'
  | 'sla-fila'
  | 'escalar-gestor'
  | 'csat';

export type BlocoCategoria = 'identidade' | 'coleta' | 'bot' | 'atendimento' | 'sla' | 'pesquisa';

export interface BlocoMeta {
  tipo: BlocoTipo;
  label: string;
  categoria: BlocoCategoria;
  /** Branches automatically created when this block is added. */
  ramos?: string[];
}

export const blocosMeta: BlocoMeta[] = [
  {
    tipo: 'identificar',
    label: 'Identificar contato',
    categoria: 'identidade',
    ramos: ['Encontrado · Entregador', 'Encontrado · Farmácia', 'Encontrado · Líder', 'Não encontrado'],
  },
  {
    tipo: 'escolha-perfil',
    label: 'Menu · perfil (contato desconhecido)',
    categoria: 'coleta',
    ramos: ['Entregador', 'Farmácia', 'Líder', 'Não entendi'],
  },
  { tipo: 'selecionar-setor', label: 'Selecionar setor', categoria: 'coleta' },
  { tipo: 'selecionar-demanda', label: 'Selecionar demanda', categoria: 'coleta' },
  { tipo: 'pergunta', label: 'Pergunta ao cliente', categoria: 'coleta' },
  { tipo: 'menu-farmacias', label: 'Menu de farmácias por cidade', categoria: 'coleta' },
  { tipo: 'enviar-mensagem', label: 'Enviar mensagem', categoria: 'bot' },
  { tipo: 'script-bot', label: 'Script do bot', categoria: 'bot' },
  { tipo: 'ia-resposta', label: 'IA · classificar/responder', categoria: 'bot' },
  { tipo: 'criar-precadastro', label: 'Criar pré-cadastro', categoria: 'atendimento' },
  { tipo: 'aplicar-tag', label: 'Aplicar tag', categoria: 'atendimento' },
  { tipo: 'notificar-atendente', label: 'Notificar atendente', categoria: 'atendimento' },
  { tipo: 'atribuir-fila', label: 'Atribuir à fila', categoria: 'atendimento' },
  { tipo: 'sla-etapa', label: 'SLA da etapa', categoria: 'sla' },
  { tipo: 'sla-fila', label: 'SLA da fila', categoria: 'sla' },
  { tipo: 'escalar-gestor', label: 'Escalar para gestor', categoria: 'sla' },
  { tipo: 'csat', label: 'Pesquisa CSAT/NPS', categoria: 'pesquisa' },
];

export const categoriasMeta: { id: BlocoCategoria; label: string }[] = [
  { id: 'identidade', label: 'Identidade' },
  { id: 'coleta', label: 'Menu / Coleta' },
  { id: 'bot', label: 'Bot / Mensagem' },
  { id: 'atendimento', label: 'Atendimento' },
  { id: 'sla', label: 'SLA / Escalação' },
  { id: 'pesquisa', label: 'Pesquisa' },
];

export interface Bloco {
  id: string;
  tipo: BlocoTipo;
  config: Record<string, unknown>;
  /** Nested children indexed by branch label. */
  ramos?: Record<string, Bloco[]>;
  collapsed?: boolean;
}

export const defaultBlocoConfig = (tipo: BlocoTipo): Record<string, unknown> => {
  switch (tipo) {
    case 'identificar':
      return { origem: 'telefone' };
    case 'escolha-perfil':
      return { titulo: 'Perfil', instrucao: 'Escolha Entregador, Farmácia ou Líder.' };
    case 'selecionar-setor':
      return { setoresIds: [] as string[], modo: 'menu' };
    case 'selecionar-demanda':
      return { perfil: 'entregador', setorIds: [] as string[], demandas: [] as string[] };
    case 'pergunta':
      return { rotulo: 'Qual seu nome?', variavel: 'nome', obrigatorio: true };
    case 'menu-farmacias':
      return { variavelCidade: 'cidade' };
    case 'enviar-mensagem':
      return { texto: 'Olá! Em que posso ajudar?', delaySeg: 0 };
    case 'script-bot':
      return { mensagens: ['Bem-vindo!', 'Vou te ajudar em instantes.'] };
    case 'ia-resposta':
      return { modelo: 'gpt-4o-mini', instrucoes: 'Classifique a intenção e responda de forma cordial.' };
    case 'criar-precadastro':
      return { tipo: 'entregador', camposExtras: '' };
    case 'aplicar-tag':
      return { tag: 'cadastro pendente' };
    case 'notificar-atendente':
      return { canal: 'painel', mensagem: 'Novo atendimento aguardando' };
    case 'atribuir-fila':
      return { filaId: '', dinamica: false };
    case 'sla-etapa':
      return { tempoMin: 5, acaoEstouro: 'escalar' };
    case 'sla-fila':
      return { tempoMin: 30, acaoEstouro: 'notificar' };
    case 'escalar-gestor':
      return { gestorId: '', canal: 'email' };
    case 'csat':
      return { pergunta: 'Como avalia seu atendimento?', escala: '1-5' };
    default:
      return {};
  }
};

export const novoBloco = (tipo: BlocoTipo): Bloco => {
  const meta = blocosMeta.find((b) => b.tipo === tipo)!;
  const ramos: Record<string, Bloco[]> | undefined = meta.ramos
    ? Object.fromEntries(meta.ramos.map((r) => [r, []]))
    : undefined;
  return {
    id: `${tipo}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    tipo,
    config: defaultBlocoConfig(tipo) as Bloco['config'],
    ramos,
  };
};

export const updateBlocoConfig = (blocos: Bloco[], id: string, key: string, value: unknown): Bloco[] =>
  blocos.map((b) => {
    if (b.id === id) return { ...b, config: { ...b.config, [key]: value } };
    if (!b.ramos) return b;
    const next: Record<string, Bloco[]> = {};
    for (const [r, list] of Object.entries(b.ramos)) next[r] = updateBlocoConfig(list, id, key, value);
    return { ...b, ramos: next };
  });

export const removeBloco = (blocos: Bloco[], id: string): Bloco[] =>
  blocos
    .filter((b) => b.id !== id)
    .map((b) => {
      if (!b.ramos) return b;
      const next: Record<string, Bloco[]> = {};
      for (const [r, list] of Object.entries(b.ramos)) next[r] = removeBloco(list, id);
      return { ...b, ramos: next };
    });

export const toggleCollapse = (blocos: Bloco[], id: string): Bloco[] =>
  blocos.map((b) => {
    if (b.id === id) return { ...b, collapsed: !b.collapsed };
    if (!b.ramos) return b;
    const next: Record<string, Bloco[]> = {};
    for (const [r, list] of Object.entries(b.ramos)) next[r] = toggleCollapse(list, id);
    return { ...b, ramos: next };
  });

export const addBlocoToBranch = (blocos: Bloco[], parentId: string, ramo: string, novo: Bloco): Bloco[] =>
  blocos.map((b) => {
    if (b.id === parentId && b.ramos) {
      return { ...b, ramos: { ...b.ramos, [ramo]: [...(b.ramos[ramo] ?? []), novo] } };
    }
    if (!b.ramos) return b;
    const next: Record<string, Bloco[]> = {};
    for (const [r, list] of Object.entries(b.ramos)) next[r] = addBlocoToBranch(list, parentId, ramo, novo);
    return { ...b, ramos: next };
  });

export const countBlocos = (blocos: Bloco[]): number =>
  blocos.reduce((acc, b) => {
    let c = 1;
    if (b.ramos) for (const list of Object.values(b.ramos)) c += countBlocos(list);
    return acc + c;
  }, 0);

export const labelOf = (tipo: BlocoTipo) => blocosMeta.find((b) => b.tipo === tipo)?.label ?? tipo;

const PROFILE_PT: Record<string, string> = {
  driver: 'Entregador',
  pharmacy: 'Farmácia',
  leader: 'Líder',
  partner: 'Parceiro',
  unknown: 'Não identificado',
};

const BOT_STEP_PT: Record<string, string> = {
  ask_if_driver: 'Confirmar se é entregador',
  ask_name: 'Coletar nome completo',
  ask_city: 'Informar cidade de atuação',
  ask_pharmacy_link: 'Vincular farmácia/unidade',
  ask_pharmacy: 'Escolher farmácia na lista',
  ask_intent: 'Identificar intenção do contato',
  ask_demand: 'Selecionar tipo de demanda',
  ask_profile: 'Confirmar perfil do contato',
  welcome: 'Boas-vindas / início do fluxo',
};

export function profileTypePt(raw: unknown): string {
  const key = String(raw || 'unknown').toLowerCase().trim();
  return PROFILE_PT[key] || (key && key !== 'unknown' ? key.charAt(0).toUpperCase() + key.slice(1) : 'Não identificado');
}

export function botStepPt(raw: unknown): string {
  const key = String(raw || '').trim();
  if (!key) return 'Sem etapa ativa';
  return BOT_STEP_PT[key] || 'Etapa do atendimento automático';
}

export function demandTitleFromKey(demandKey: unknown, channelDemands?: Array<{ id?: string; demand_key?: string; title?: string; name?: string }>): string {
  const key = String(demandKey || '').trim();
  if (!key) return 'Pendente';
  const hit = (channelDemands || []).find(
    (d) => String(d.id || d.demand_key || '') === key || String(d.demand_key || '') === key
  );
  if (hit?.title) return String(hit.title);
  if (hit?.name) return String(hit.name);
  return key.replace(/[-_]/g, ' ');
}

export function clientSincePt(createdAt: string | null | undefined): string {
  if (!createdAt) return '';
  const start = new Date(createdAt);
  if (!Number.isFinite(start.getTime())) return '';
  const months = Math.max(
    0,
    Math.floor((Date.now() - start.getTime()) / (30.44 * 24 * 60 * 60 * 1000))
  );
  if (months < 1) return 'Cliente recente';
  if (months < 12) return `Cliente há ${months} ${months === 1 ? 'mês' : 'meses'}`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (rem === 0) return `Cliente há ${years} ${years === 1 ? 'ano' : 'anos'}`;
  return `Cliente há ${years} ${years === 1 ? 'ano' : 'anos'} e ${rem} ${rem === 1 ? 'mês' : 'meses'}`;
}

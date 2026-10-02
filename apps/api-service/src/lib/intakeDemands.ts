import { supabase } from './supabase';
import { getWorkspaceWhatsAppChannel } from './channelResolver';

export type IntakeDemandProfile = 'driver' | 'pharmacy';

export type IntakeDemandRow = { demand_key: string; title: string };

export type IntakeDemandsSource = 'channel_config' | 'workspace_catalog' | 'static';

function normalizeMacroSectorName(name: string): string {
  const n = String(name || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
  if (n.includes('operacional')) return 'operacional';
  if (n.includes('atendimento') && n.includes('geral')) return 'atendimento geral';
  if (n.includes('financeiro')) return 'financeiro';
  if (n.includes('suporte')) return 'suporte tecnico';
  return n;
}

function normalizeSectorKey(name: string) {
  return normalizeMacroSectorName(name).replace(/\s+/g, '-');
}

function asRecord(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

function stringArray(raw: unknown): string[] {
  return Array.isArray(raw) ? raw.map(String).filter(Boolean) : [];
}

function matchesProfile(demandKey: string, profile: IntakeDemandProfile): boolean {
  const k = demandKey.toLowerCase();
  if (profile === 'driver') return k.startsWith('drv-');
  return k.startsWith('ph-');
}

const DRIVER_DEMANDS: Record<string, IntakeDemandRow[]> = {
  operacional: [{ demand_key: 'drv-op-cadastro', title: 'Dados cadastrais (PIX, telefone, e-mail)' }],
  'atendimento geral': [
    { demand_key: 'drv-ag-mei', title: 'MEI — abertura e obrigações' },
    { demand_key: 'drv-ag-cert', title: 'Certificado digital (e-CPF / ICP-Brasil)' },
    { demand_key: 'drv-ag-benef', title: 'Benefícios e vales' },
    { demand_key: 'drv-ag-comp', title: 'Comprovantes e declarações (IR, extrato)' },
  ],
  financeiro: [
    { demand_key: 'drv-fin-pag', title: 'Pagamento / repasse não recebido' },
    { demand_key: 'drv-fin-desc', title: 'Contestação de desconto na corrida' },
    { demand_key: 'drv-fin-adv', title: 'Adiantamento de valores' },
  ],
  'suporte tecnico': [{ demand_key: 'drv-tech-app', title: 'App do entregador (login, erro, travamento)' }],
};

const PHARMACY_DEMANDS: Record<string, IntakeDemandRow[]> = {
  operacional: [
    { demand_key: 'ph-op-escala', title: 'Escala / quadro / plantão' },
    { demand_key: 'ph-op-falta', title: 'Falta de entregador na loja' },
    { demand_key: 'ph-op-atraso', title: 'Atraso na coleta ou saída' },
    { demand_key: 'ph-op-cob', title: 'Cobertura / substituição de entregador' },
  ],
  'atendimento geral': [{ demand_key: 'ph-ag-cond', title: 'Conduta do entregador (reclamação)' }],
  financeiro: [
    { demand_key: 'ph-fin-fat', title: 'Fatura / repasse à farmácia' },
    { demand_key: 'ph-fin-cont', title: 'Contestação de cobrança ou valor' },
  ],
  'suporte tecnico': [
    { demand_key: 'ph-tech-lenta', title: 'Plataforma lenta ou indisponível' },
    { demand_key: 'ph-tech-duv', title: 'Como usar a plataforma de gestão' },
    { demand_key: 'ph-tech-bug', title: 'Erro ou falha na gestão de entregas' },
  ],
};

function staticDemandsForSector(profile: IntakeDemandProfile, sectorDisplayName: string): IntakeDemandRow[] {
  const key = normalizeMacroSectorName(sectorDisplayName);
  const map = profile === 'driver' ? DRIVER_DEMANDS : PHARMACY_DEMANDS;
  return map[key] || [];
}

async function loadDemandsFromChannelConfig(
  workspaceId: string,
  sectorId: string,
  sectorName: string,
  profile: IntakeDemandProfile
): Promise<IntakeDemandRow[] | null> {
  const channel = await getWorkspaceWhatsAppChannel(workspaceId);
  const config = asRecord(channel?.config);
  const sectors = Array.isArray(config.sectors) ? (config.sectors as Record<string, unknown>[]) : [];
  const demands = Array.isArray(config.demands) ? (config.demands as Record<string, unknown>[]) : [];
  if (!demands.length) return null;

  const sectorNameById = new Map<string, string>();
  for (const sector of sectors) {
    if (sector.is_active === false) continue;
    const id = String(sector.id || sector.sector_id || '').trim();
    const name = String(sector.name || '').trim();
    if (id && name) sectorNameById.set(id, name);
  }

  const sectorKey = normalizeSectorKey(sectorName);
  const out: IntakeDemandRow[] = [];

  for (const demand of demands) {
    if (demand.is_active === false) continue;
    const demandKey = String(demand.id || demand.demand_key || '').trim();
    const title = String(demand.title || demand.name || '').trim();
    if (!demandKey || !title) continue;
    if (!matchesProfile(demandKey, profile)) continue;

    const sectorIds = stringArray(demand.sector_ids);
    const matchesSector = sectorIds.some((sid) => {
      if (sid === sectorId) return true;
      const mapped = sectorNameById.get(sid);
      return mapped ? normalizeSectorKey(mapped) === sectorKey : normalizeSectorKey(sid) === sectorKey;
    });
    if (!matchesSector) continue;

    if (!out.some((r) => r.demand_key === demandKey)) {
      out.push({ demand_key: demandKey, title });
    }
  }

  return out.length ? out : null;
}

async function loadDemandsFromDatabase(
  workspaceId: string,
  sectorName: string,
  profile: IntakeDemandProfile
): Promise<IntakeDemandRow[] | null> {
  const sectorKey = normalizeSectorKey(sectorName);
  const { data, error } = await supabase
    .from('workspace_sector_demands')
    .select('demand_key, title, sort_order')
    .eq('workspace_id', workspaceId)
    .eq('profile_code', profile)
    .eq('sector_key', sectorKey)
    .eq('is_active', true)
    .order('sort_order');

  if (error) throw new Error(error.message);
  if (!data?.length) return null;
  return data.map((row) => ({
    demand_key: String(row.demand_key),
    title: String(row.title),
  }));
}

export function resolveIntakeDemandProfile(driverId?: string | null): IntakeDemandProfile {
  return driverId?.trim() ? 'driver' : 'pharmacy';
}

export async function listIntakeDemandsForLeader(args: {
  workspaceId: string;
  sectorId: string;
  driverId?: string | null;
}): Promise<{
  demands: IntakeDemandRow[];
  demand_profile: IntakeDemandProfile;
  source: IntakeDemandsSource;
  sector_name: string;
}> {
  const { data: sector, error: sectorErr } = await supabase
    .from('sectors')
    .select('id, name')
    .eq('workspace_id', args.workspaceId)
    .eq('id', args.sectorId)
    .maybeSingle();
  if (sectorErr) throw new Error(sectorErr.message);
  if (!sector?.id) throw new Error('Setor não encontrado.');

  const sectorName = String(sector.name || '');
  const demand_profile = resolveIntakeDemandProfile(args.driverId);

  const fromChannel = await loadDemandsFromChannelConfig(
    args.workspaceId,
    args.sectorId,
    sectorName,
    demand_profile
  );
  if (fromChannel?.length) {
    return { demands: fromChannel, demand_profile, source: 'channel_config', sector_name: sectorName };
  }

  const fromDb = await loadDemandsFromDatabase(args.workspaceId, sectorName, demand_profile);
  if (fromDb?.length) {
    return { demands: fromDb, demand_profile, source: 'workspace_catalog', sector_name: sectorName };
  }

  const staticList = staticDemandsForSector(demand_profile, sectorName);
  return { demands: staticList, demand_profile, source: 'static', sector_name: sectorName };
}

function defaultChannelSla() {
  return {
    first_response_action: 'alert_attendant',
    treatment_action: 'alert_and_reassign',
    resolution_action: 'escalate_supervisor',
    use_business_hours: true,
    business_hours_id: 'default',
    first_response_sla_minutes: 25,
    treatment_sla_minutes: 120,
    resolution_sla_minutes: 480,
  };
}

function staticSlaForDemand(demandKey: string): Record<string, unknown> {
  const base = defaultChannelSla();
  if (demandKey === 'ldr-setor') return base;
  if (demandKey.includes('fin-') || demandKey.includes('ph-fin-')) {
    return { ...base, first_response_sla_minutes: 15, treatment_sla_minutes: 90, resolution_sla_minutes: 360 };
  }
  if (demandKey.includes('tech') || demandKey.includes('ph-tech')) {
    return { ...base, first_response_sla_minutes: 15, treatment_sla_minutes: 60, resolution_sla_minutes: 240 };
  }
  return base;
}

export async function resolveSlaSettingsForDemand(
  workspaceId: string,
  demandKey: string,
  profile: IntakeDemandProfile
): Promise<Record<string, unknown>> {
  const channel = await getWorkspaceWhatsAppChannel(workspaceId);
  const config = asRecord(channel?.config);
  const demands = Array.isArray(config.demands) ? (config.demands as Record<string, unknown>[]) : [];
  const slaDefault = { ...defaultChannelSla(), ...asRecord(config.sla) };

  for (const demand of demands) {
    const id = String(demand.id || demand.demand_key || '').trim();
    if (id !== demandKey) continue;
    return { ...slaDefault, ...asRecord(demand.sla_override) };
  }

  const { data: slaRow } = await supabase
    .from('workspace_sla_rules')
    .select('settings')
    .eq('workspace_id', workspaceId)
    .eq('demand_key', demandKey)
    .eq('profile_code', profile)
    .maybeSingle();

  if (slaRow?.settings && typeof slaRow.settings === 'object') {
    return slaRow.settings as Record<string, unknown>;
  }

  const { data: slaAny } = await supabase
    .from('workspace_sla_rules')
    .select('settings')
    .eq('workspace_id', workspaceId)
    .eq('demand_key', demandKey)
    .maybeSingle();

  if (slaAny?.settings && typeof slaAny.settings === 'object') {
    return slaAny.settings as Record<string, unknown>;
  }

  return staticSlaForDemand(demandKey);
}

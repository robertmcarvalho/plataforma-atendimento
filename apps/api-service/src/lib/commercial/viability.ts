import { supabase } from '../supabase';
import type { CommercialMotorConfig } from './commercialMotorConfigCore';
import { DEFAULT_MOTOR_CONFIG } from './commercialMotorConfigCore';

export type ViabilityResult = {
  city: string;
  state: string;
  volume: number;
  status: 'viavel' | 'atencao' | 'inviavel';
  summary: string;
  leader_available: boolean;
  estimated_drivers: number;
  /** Entregadores ativos cadastrados na Aethera na região. */
  aethera_drivers_in_city: number;
  /** Líderes ativos na região. */
  leaders_in_city: number;
};

type CacheEntry = { at: number; result: ViabilityResult };
const CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = Number(process.env.COMMERCIAL_VIABILITY_CACHE_TTL_SEC || 300) * 1000;

function cacheKey(workspaceId: string, city: string, state: string, volume: number) {
  return `${workspaceId}|${state}|${city.toLowerCase().trim()}|${volume}`;
}

function normalizeCityKey(city: string) {
  return city
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

function matchesCityState(rowCity: string, rowState: string, city: string, state: string): boolean {
  const cityKey = normalizeCityKey(city);
  const lc = normalizeCityKey(rowCity);
  const ls = String(rowState || '').toUpperCase().trim();
  const uf = state.toUpperCase();
  return ls === uf && (lc === cityKey || lc.includes(cityKey) || cityKey.includes(lc));
}

export async function countLeadersInCity(workspaceId: string, city: string, state: string): Promise<number> {
  const { data, error } = await supabase
    .from('leaders')
    .select('id, city, state, status')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  if (error || !data?.length) return 0;
  return data.filter((l) => matchesCityState(String(l.city || ''), String(l.state || ''), city, state)).length;
}

export async function countAetheraDriversInCity(
  workspaceId: string,
  city: string,
  state: string,
): Promise<number> {
  const { data, error } = await supabase
    .from('drivers')
    .select('id, city, state, status')
    .eq('workspace_id', workspaceId)
    .eq('status', 'active');
  if (error || !data?.length) return 0;
  return data.filter((d) => matchesCityState(String(d.city || ''), String(d.state || ''), city, state)).length;
}

function buildResult(
  city: string,
  state: string,
  volume: number,
  leaderCount: number,
  aetheraDrivers: number,
  motor: CommercialMotorConfig = DEFAULT_MOTOR_CONFIG,
): ViabilityResult {
  const vol = Math.max(0, volume);
  const vcfg = motor.viabilidade;
  const leader_available = leaderCount > 0;
  const estimated_drivers = Math.max(1, Math.ceil(vol / vcfg.entregas_por_entregador));

  if (vol === 0) {
    return {
      city,
      state,
      volume: vol,
      status: 'inviavel',
      summary: 'Informe o volume estimado de entregas para consulta.',
      leader_available: false,
      estimated_drivers: 0,
      aethera_drivers_in_city: aetheraDrivers,
      leaders_in_city: leaderCount,
    };
  }

  if (!leader_available) {
    return {
      city,
      state,
      volume: vol,
      status: 'inviavel',
      summary: `Sem líder ativo cadastrado em ${city}/${state} na Aethera. Avalie expansão antes do go-live.`,
      leader_available: false,
      estimated_drivers,
      aethera_drivers_in_city: aetheraDrivers,
      leaders_in_city: leaderCount,
    };
  }

  let status: ViabilityResult['status'] = 'viavel';
  let summary = `${city}/${state}: ${leaderCount} líder(es) e ${aetheraDrivers} entregador(es) ativos na Aethera.`;

  if (vol > vcfg.volume_alto) {
    status = 'atencao';
    summary = `${summary} Volume alto — validar SLA e capacidade com coordenação.`;
  } else if (vol < vcfg.volume_baixo) {
    status = 'atencao';
    summary = `${summary} Volume baixo — avaliar viabilidade econômica do pacote.`;
  }

  if (aetheraDrivers === 0) {
    status = 'atencao';
    summary = `${summary} Nenhum entregador ativo na região — confirme ramp-up.`;
  } else if (aetheraDrivers < estimated_drivers) {
    status = 'atencao';
    summary = `${summary} Capacidade Aethera (${aetheraDrivers}) abaixo do estimado (${estimated_drivers}) — planeje contratações.`;
  }

  return {
    city,
    state,
    volume: vol,
    status,
    summary,
    leader_available,
    estimated_drivers,
    aethera_drivers_in_city: aetheraDrivers,
    leaders_in_city: leaderCount,
  };
}

/** Viabilidade operacional com dados cadastrados na Aethera (sem API Flux). */
export async function computeViability(
  workspaceId: string,
  city: string,
  state: string,
  volume: number,
  motor: CommercialMotorConfig = DEFAULT_MOTOR_CONFIG,
): Promise<ViabilityResult> {
  const uf = state.toUpperCase().trim();
  const key = cacheKey(workspaceId, city, uf, volume);
  const hit = CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.result;

  const [leaderCount, aetheraDrivers] = await Promise.all([
    countLeadersInCity(workspaceId, city, uf),
    countAetheraDriversInCity(workspaceId, city, uf),
  ]);

  const result = buildResult(city, uf, volume, leaderCount, aetheraDrivers, motor);
  CACHE.set(key, { at: Date.now(), result });
  return result;
}

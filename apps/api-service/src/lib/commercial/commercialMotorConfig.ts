export * from './commercialMotorConfigCore';

import { readPlatformSetting } from '../platformSettings';
import { readWorkspaceSetting, upsertWorkspaceSetting } from '../workspaceSettings';
import {
  DEFAULT_MOTOR_CONFIG,
  mergeMotorConfig,
  type CommercialMotorConfig,
  type MotorConfigPatch,
} from './commercialMotorConfigCore';

export const COMMERCIAL_MOTOR_CONFIG_KEY = 'commercial_motor_config';

type CacheEntry = { at: number; config: CommercialMotorConfig };
const CONFIG_CACHE = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60_000;

export async function resolveCommercialMotorConfig(
  workspaceId: string,
  patch?: MotorConfigPatch | null,
): Promise<CommercialMotorConfig> {
  if (patch) {
    const base = await resolveCommercialMotorConfig(workspaceId);
    return mergeMotorConfig(base, patch);
  }

  const hit = CONFIG_CACHE.get(workspaceId);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.config;

  const [workspaceRaw, platformRaw] = await Promise.all([
    readWorkspaceSetting(workspaceId, COMMERCIAL_MOTOR_CONFIG_KEY),
    readPlatformSetting<Partial<CommercialMotorConfig>>('commercial_motor_config_default'),
  ]);

  let config = DEFAULT_MOTOR_CONFIG;
  if (platformRaw) config = mergeMotorConfig(config, platformRaw);
  if (workspaceRaw) config = mergeMotorConfig(config, workspaceRaw as MotorConfigPatch);

  CONFIG_CACHE.set(workspaceId, { at: Date.now(), config });
  return config;
}

export async function hasCustomMotorConfig(workspaceId: string): Promise<boolean> {
  const raw = await readWorkspaceSetting(workspaceId, COMMERCIAL_MOTOR_CONFIG_KEY);
  return raw != null;
}

export function invalidateMotorConfigCache(workspaceId?: string) {
  if (workspaceId) CONFIG_CACHE.delete(workspaceId);
  else CONFIG_CACHE.clear();
}

export async function saveCommercialMotorConfig(
  workspaceId: string,
  patch: MotorConfigPatch,
): Promise<CommercialMotorConfig> {
  const current = await resolveCommercialMotorConfig(workspaceId);
  const next = mergeMotorConfig(current, patch);
  await upsertWorkspaceSetting(workspaceId, COMMERCIAL_MOTOR_CONFIG_KEY, next);
  invalidateMotorConfigCache(workspaceId);
  return next;
}

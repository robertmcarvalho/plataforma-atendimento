import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseEnvFile } from './loadProdEnv.mjs';

const ENV_FILES = {
  homolog: 'flux-delivery-homolog.env',
  prod: 'flux-delivery-prod.env',
};

export function loadFluxDeliveryEnv(envName = 'homolog', repoRoot = process.cwd()) {
  const fileName = ENV_FILES[envName] || ENV_FILES.homolog;
  const secretPath = path.join(repoRoot, '.secrets', fileName);
  if (existsSync(secretPath)) {
    parseEnvFile(secretPath, true);
  }

  const baseUrl =
    process.env.FLUX_DELIVERY_BASE_URL?.trim() ||
    (envName === 'prod' ? 'https://delivery-flux-it.com.br' : 'https://flux-delivery-homol.com.br');

  return {
    envName,
    baseUrl: baseUrl.replace(/\/$/, ''),
    clientId: process.env.FLUX_DELIVERY_OAUTH_CLIENT_ID?.trim() || 'SD',
    clientSecret: process.env.FLUX_DELIVERY_OAUTH_CLIENT_SECRET?.trim() || '',
    username: process.env.FLUX_DELIVERY_USERNAME?.trim() || '',
    password: process.env.FLUX_DELIVERY_PASSWORD?.trim() || '',
  };
}

export function assertFluxDeliveryConfig(cfg) {
  const missing = [];
  if (!cfg.clientSecret) missing.push('FLUX_DELIVERY_OAUTH_CLIENT_SECRET');
  if (!cfg.username) missing.push('FLUX_DELIVERY_USERNAME');
  if (!cfg.password) missing.push('FLUX_DELIVERY_PASSWORD');
  if (missing.length) {
    throw new Error(
      `Credenciais Flux ausentes: ${missing.join(', ')}. Copie .secrets/flux-delivery-homolog.env.example para .secrets/flux-delivery-homolog.env`
    );
  }
}

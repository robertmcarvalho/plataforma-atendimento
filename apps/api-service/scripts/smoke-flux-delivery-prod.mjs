#!/usr/bin/env node
/**
 * Smoke da API Flux (produção) — token + amostra de entregadores.
 * Requer .secrets/flux-delivery-prod.env
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFluxDeliveryEnv, assertFluxDeliveryConfig } from '../../../scripts/lib/loadFluxDeliveryEnv.mjs';
import { createFluxDeliveryClient } from '../../../scripts/lib/fluxDeliveryClient.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const cfg = loadFluxDeliveryEnv('prod', repoRoot);
assertFluxDeliveryConfig(cfg);
const client = createFluxDeliveryClient(cfg);

const token = await client.getAccessToken();
if (!token) throw new Error('Token vazio');

const sample = await client.fetchAllEntregadores({ pageSize: 5 });
console.log('OK: Flux prod token + entregadores', { count_sample: sample.length, first_id: sample[0]?.idEntregador });

#!/usr/bin/env node
/**
 * Validação pós-deploy CRM + rotas públicas (produção).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiBase = process.env.API_BASE_URL || 'https://flux-farma-api-713561463013.us-central1.run.app';

function parseBootstrap() {
  const p = path.join(repoRoot, 'reports', 'platform-owner-bootstrap.txt');
  const text = fs.readFileSync(p, 'utf8');
  const email = text.match(/^email=(.+)$/m)?.[1]?.trim();
  const password = text.match(/^password=(.+)$/m)?.[1]?.trim();
  if (!email || !password) throw new Error('platform-owner-bootstrap.txt incompleto');
  return { email, password };
}

async function http(method, urlPath, { token, body } = {}) {
  const res = await fetch(`${apiBase}${urlPath}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text.slice(0, 200) };
  }
  return { ok: res.ok, status: res.status, json };
}

const lines = [];
function log(msg) {
  lines.push(msg);
  console.log(msg);
}

const health = await http('GET', '/health');
log(health.ok ? 'OK health' : `FAIL health ${health.status}`);

const states = await http('GET', '/api/public/commercial/geo/states');
log(states.ok && Array.isArray(states.json) ? `OK public geo states (${states.json.length})` : `FAIL public geo ${states.status}`);

const { email, password } = parseBootstrap();
const login = await http('POST', '/api/auth/login', { body: { email, password } });
const token = login.json?.token;
if (!login.ok || !token) {
  log(`FAIL login ${login.status}`);
} else {
  log('OK login');
  const stages = await http('GET', '/api/commercial/pipeline-stages', { token });
  log(stages.ok ? `OK commercial pipeline-stages (${(stages.json || []).length})` : `FAIL stages ${stages.status}`);
  const viability = await http('POST', '/api/commercial/viability/check', {
    token,
    body: { city: 'Belo Horizonte', state: 'MG', volume: 200 },
  });
  if (viability.status === 503) {
    log('WARN viability 503 (Flux não configurado no Cloud Run — esperado até secrets FLUX_*)');
  } else if (viability.ok && viability.json?.status) {
    log(`OK viability (${viability.json.status})`);
  } else {
    log(`FAIL viability ${viability.status}`);
  }
}

const out = path.join(repoRoot, 'reports', `validate-commercial-deploy-${Date.now()}.txt`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8');
log(`Report: ${out}`);

const failed = lines.some((l) => l.startsWith('FAIL'));
process.exit(failed ? 1 : 0);

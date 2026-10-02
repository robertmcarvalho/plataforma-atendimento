#!/usr/bin/env node
/**
 * Orquestra validações locais (API em localhost:3001).
 *
 *   node scripts/run-local-validation.mjs
 *   API_ATTENDANT_EMAIL=... API_ATTENDANT_PASSWORD=... (opcional; default dev-admin)
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loginAdmin } from './stress/lib/httpClient.mjs';

const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const report = { at: new Date().toISOString(), baseUrl, steps: [] };

function run(name, cmd, env = {}) {
  const res = spawnSync(cmd, {
    shell: true,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    cwd: process.cwd(),
  });
  const step = {
    name,
    exit: res.status ?? 1,
    stdout: (res.stdout || '').slice(-4000),
    stderr: (res.stderr || '').slice(-2000),
  };
  report.steps.push(step);
  console.log(step.exit === 0 ? `OK  ${name}` : `FAIL ${name} (exit ${step.exit})`);
  return step.exit === 0;
}

async function probeApi() {
  try {
    const res = await fetch(`${baseUrl}/health`);
    const body = await res.json();
    return res.ok && body?.status === 'ok';
  } catch {
    return false;
  }
}

if (!(await probeApi())) {
  console.error(`API indisponível em ${baseUrl}. Execute: npm run dev:api`);
  process.exit(1);
}

run('governance:workspace', 'npm run governance:workspace');
run('governance:automations', 'npm run governance:automations');

const adminEmail = process.env.API_ADMIN_EMAIL || 'dev-admin@fluxfarma.local';
const adminPass = process.env.API_ADMIN_PASSWORD || '';
const attendantEmail = process.env.API_ATTENDANT_EMAIL || 'qa-atendente@fluxfarma.local';
const attendantPass = process.env.API_ATTENDANT_PASSWORD || 'QaAtendente@2026!';

run('create-qa-test-users', 'node scripts/create-qa-test-users.mjs');
run('create-qa-leader-robert', 'node scripts/create-qa-leader-robert.mjs');

if (adminPass) {
  process.env.API_BASE_URL = baseUrl;
  process.env.API_ADMIN_EMAIL = adminEmail;
  process.env.API_ADMIN_PASSWORD = adminPass;
  run('chaos:staging', 'npm run chaos:staging', {
    CONFIRM_STAGING_CHAOS: 'true',
    CHAOS_SKIP_PUBSUB: 'true',
    API_BASE_URL: baseUrl,
    API_ADMIN_EMAIL: adminEmail,
    API_ADMIN_PASSWORD: adminPass,
  });
  run('stress:staging', 'npm run stress:staging', {
    STRESS_DURATION_SEC: process.env.STRESS_DURATION_SEC || '15',
    STRESS_CONCURRENCY: process.env.STRESS_CONCURRENCY || '8',
    API_BASE_URL: baseUrl,
    API_ADMIN_EMAIL: adminEmail,
    API_ADMIN_PASSWORD: adminPass,
  });
}

process.env.API_BASE_URL = baseUrl;
process.env.API_ATTENDANT_EMAIL = attendantEmail;
process.env.API_ATTENDANT_PASSWORD = attendantPass;
run('security:api-cross-tenant', 'npm run security:api-cross-tenant', {
  API_BASE_URL: baseUrl,
  API_ATTENDANT_EMAIL: attendantEmail,
  API_ATTENDANT_PASSWORD: attendantPass,
});

process.env.LEADER_A_EMAIL = process.env.LEADER_A_EMAIL || 'qa-lider-robert@fluxfarma.local';
process.env.LEADER_A_PASSWORD = process.env.LEADER_A_PASSWORD || 'QaLiderRobert@2026!';
run('security:leader-portal-idor', 'npm run security:leader-portal-idor', {
  API_BASE_URL: baseUrl,
  LEADER_A_EMAIL: process.env.LEADER_A_EMAIL,
  LEADER_A_PASSWORD: process.env.LEADER_A_PASSWORD,
});

const failed = report.steps.filter((s) => s.exit !== 0);
report.summary = { ok: failed.length === 0, passed: report.steps.length - failed.length, failed: failed.length };

mkdirSync(join(process.cwd(), 'reports'), { recursive: true });
const outPath = join(process.cwd(), 'reports', `local-validation-${Date.now()}.json`);
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ report: outPath, ...report.summary }, null, 2));
process.exit(failed.length ? 1 : 0);

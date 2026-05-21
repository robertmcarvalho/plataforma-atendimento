#!/usr/bin/env node
import { httpJson, loginAdmin } from './lib/httpClient.mjs';

/**
 * Stress controlado para STAGING (não usar em produção).
 *
 * Uso:
 *   $env:API_BASE_URL="https://api-staging.example"
 *   $env:API_ADMIN_EMAIL="admin@..."
 *   $env:API_ADMIN_PASSWORD="..."
 *   $env:STRESS_DURATION_SEC="60"
 *   $env:STRESS_CONCURRENCY="20"
 *   $env:STRESS_RPS_TARGET="0"   # 0 = saturar concurrency
 *   node scripts/stress/staging-load-test.mjs
 */
const baseUrl = (process.env.API_BASE_URL || 'http://localhost:3001').replace(/\/$/, '');
const email = process.env.API_ADMIN_EMAIL || '';
const password = process.env.API_ADMIN_PASSWORD || '';
const durationSec = Math.max(10, Number(process.env.STRESS_DURATION_SEC || 60));
const concurrency = Math.min(100, Math.max(1, Number(process.env.STRESS_CONCURRENCY || 15)));
const rpsTarget = Math.max(0, Number(process.env.STRESS_RPS_TARGET || 0));

if (!email || !password) {
  console.error('Defina API_ADMIN_EMAIL e API_ADMIN_PASSWORD.');
  process.exit(1);
}
if (/production|aetheraai\.online/i.test(baseUrl) && process.env.CONFIRM_PRODUCTION_STRESS !== 'true') {
  console.error('Bloqueado: stress em produção. Use staging ou CONFIRM_PRODUCTION_STRESS=true (não recomendado).');
  process.exit(1);
}

let token;
try {
  token = await loginAdmin(baseUrl, email, password);
} catch (e) {
  console.error('Login falhou:', e.message);
  process.exit(1);
}

async function http(path, init = {}) {
  const res = await httpJson(baseUrl, path, init);
  return { status: res.status, ok: res.ok, ms: res.ms, body: res.body };
}

const headers = {
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'x-correlation-id': `stress-${Date.now()}`,
};

async function dashboardOrPresence() {
  const dash = await http('/api/dashboard/summary', { headers });
  if (dash.ok) return dash;
  return http('/api/presence/me', { headers });
}

const scenarios = [
  () => http('/health', { headers: { 'x-correlation-id': `stress-h-${Date.now()}` } }),
  () => http('/api/conversations?status=open&page=1&limit=20', { headers }),
  () => dashboardOrPresence(),
  () => http('/api/presence/me', { headers }),
];

const stats = { total: 0, ok: 0, err: 0, latencies: [] };
const endAt = Date.now() + durationSec * 1000;
let inFlight = 0;
let stopped = false;

function percentile(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

async function oneRequest() {
  const fn = scenarios[Math.floor(Math.random() * scenarios.length)];
  try {
    const res = await fn();
    stats.total += 1;
    stats.latencies.push(res.ms);
    if (res.ok) stats.ok += 1;
    else stats.err += 1;
  } catch {
    stats.total += 1;
    stats.err += 1;
  }
}

async function worker() {
  while (!stopped && Date.now() < endAt) {
    if (rpsTarget > 0) {
      await oneRequest();
      await new Promise((r) => setTimeout(r, 1000 / rpsTarget));
      continue;
    }
    while (!stopped && Date.now() < endAt && inFlight < concurrency) {
      inFlight += 1;
      void oneRequest().finally(() => {
        inFlight -= 1;
      });
      await new Promise((r) => setImmediate(r));
    }
    await new Promise((r) => setTimeout(r, 50));
  }
}

console.log(JSON.stringify({ event: 'stress.start', baseUrl, durationSec, concurrency, rpsTarget }, null, 2));
const workers = Array.from({ length: concurrency }, () => worker());
await Promise.all(workers);
stopped = true;
await new Promise((r) => setTimeout(r, 500));

const report = {
  event: 'stress.end',
  duration_sec: durationSec,
  concurrency,
  requests: stats.total,
  success: stats.ok,
  errors: stats.err,
  error_rate_pct: stats.total ? Number(((stats.err / stats.total) * 100).toFixed(2)) : 0,
  latency_ms: {
    p50: Math.round(percentile(stats.latencies, 50)),
    p95: Math.round(percentile(stats.latencies, 95)),
    p99: Math.round(percentile(stats.latencies, 99)),
    max: Math.round(Math.max(0, ...stats.latencies)),
  },
};

console.log(JSON.stringify(report, null, 2));
if (report.error_rate_pct > 5 || report.latency_ms.p95 > 3000) {
  console.error('STRESS_FAIL — error_rate > 5% ou p95 > 3000ms');
  process.exit(1);
}

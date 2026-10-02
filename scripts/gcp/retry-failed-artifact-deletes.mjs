#!/usr/bin/env node
/**
 * Retry delete dos 3 digests que falharam no cleanup anterior.
 * Uso: EXECUTE_CLEANUP=true node scripts/gcp/retry-failed-artifact-deletes.mjs
 */
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot';
const execute = process.env.EXECUTE_CLEANUP === 'true';

const TARGETS = [
  'us-central1-docker.pkg.dev/rh-coopmob-bot/panel-services/flux-farma-scheduler@sha256:98aa1351475805fce6e082876bf7aa332aa72f40fa74836f66d408f18c204e91',
  'us-central1-docker.pkg.dev/rh-coopmob-bot/panel-services/flux-farma-campaign@sha256:739e13adadf3ff0f31068221eb16df6f8ce30aee03cd44851a751b8d1b671c73',
  'us-central1-docker.pkg.dev/rh-coopmob-bot/panel-services/flux-farma-campaign@sha256:e46315d223839507b4d0e552fd90722d85c11c8dfa7b9053dc0181c45718b451',
];

function gcloud(args) {
  const bin = process.platform === 'win32' ? 'gcloud.cmd' : 'gcloud';
  return execFileSync(bin, [...args, '--project', project], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: process.platform === 'win32',
  }).trim();
}

const report = { execute, deleted: [], skipped: [], errors: [] };

for (const ref of TARGETS) {
  try {
    gcloud(['artifacts', 'docker', 'images', 'describe', ref, '--format=value(image_summary.digest)']);
  } catch {
    report.skipped.push({ ref, reason: 'NOT_FOUND' });
    console.log('SKIP (not found)', ref);
    continue;
  }
  if (!execute) {
    console.log('WOULD_DELETE', ref);
    continue;
  }
  try {
    gcloud(['artifacts', 'docker', 'images', 'delete', ref, '--quiet', '--delete-tags']);
    report.deleted.push(ref);
    console.log('DELETED', ref);
  } catch (e) {
    const msg = String(e?.stderr || e?.stdout || e?.message || e);
    report.errors.push({ ref, error: msg });
    console.error('FAILED', ref, msg.split('\n').slice(-3).join(' '));
  }
}

mkdirSync('reports', { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const out = join('reports', `artifact-registry-retry-${stamp}.json`);
writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
console.log('Report:', out);

#!/usr/bin/env node
/**
 * Falha se gráficos usarem var() vazio ou padrões legados sem chartTheme.
 * Uso: node scripts/check-chart-tokens.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');

const FORBIDDEN = [/var\(\)/, /stroke="var\(\)"/, /stopColor="var\(\)"/];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const rel = relative(join(import.meta.dirname, '..', '..', 'apps', 'web'), file).replace(/\\/g, '/');
  const key = rel.slice('src/'.length);
  const text = readFileSync(file, 'utf8');
  for (const re of FORBIDDEN) {
    if (re.test(text)) {
      hits.push(key);
      break;
    }
  }
}

if (hits.length) {
  console.error('Invalid chart CSS tokens (var() empty):\n');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log('OK — no empty var() in chart/sparkline code');

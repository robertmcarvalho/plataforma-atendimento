#!/usr/bin/env node
/**
 * Falha se role="switch" aparecer fora do Switch canônico.
 * Uso: node scripts/check-switch.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');
const ALLOWLIST = new Set(['components/ui/Switch.tsx', 'components/ui/checkbox.tsx']);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const rel = relative(join(import.meta.dirname, '..', '..', 'apps', 'web'), file).replace(/\\/g, '/');
  const key = rel.slice('src/'.length);
  if (ALLOWLIST.has(key)) continue;
  const text = readFileSync(file, 'utf8');
  if (/role=["']switch["']/.test(text)) hits.push(key);
}

if (hits.length) {
  console.error('Custom role="switch" outside Switch.tsx:\n');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log('OK — no custom role=switch toggles');

#!/usr/bin/env node
/**
 * Falha se TSX usa classes CSS legadas migradas para Tailwind/primitivos.
 * Uso: node scripts/check-legacy-css-class.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');

const BANNED = [
  'inbox-queue-pill',
  'status-chip',
  'metric-card',
  'drawer-tab',
  'inbox-panel',
];

const ALLOWLIST = new Set(['app/globals.css']);

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
  if (ALLOWLIST.has(rel.slice('src/'.length))) continue;
  const text = readFileSync(file, 'utf8');
  for (const cls of BANNED) {
    if (text.includes(cls)) {
      hits.push(`${rel.slice('src/'.length)} → ${cls}`);
      break;
    }
  }
}

if (hits.length) {
  console.error('TSX com classes CSS legadas:\n');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log('OK — sem classes CSS legadas em TSX');

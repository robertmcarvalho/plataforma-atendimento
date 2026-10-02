#!/usr/bin/env node
/**
 * Falha se TSX de produto usa <select nativo (use FormSelect / ToolbarSelect).
 * Uso: node scripts/check-native-select.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');
const ALLOW = new Set([
  'components/form/FormSelect.tsx', // comentário de documentação
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  if (ALLOW.has(rel)) continue;
  const text = readFileSync(file, 'utf8');
  if (/<select[\s>]/.test(text)) hits.push(rel);
}

if (hits.length) {
  console.error('TSX com <select> nativo (migre para FormSelect / ToolbarSelect):\n');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log('OK — nenhum <select> nativo em apps/web/src');

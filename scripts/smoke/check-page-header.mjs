#!/usr/bin/env node
/**
 * Falha se PageHeader usa variant="plain" em páginas de produto (exceto inbox).
 * PageHeader com icon/card é o padrão visual do apps/web.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');

const ALLOW_PLAIN = [
  'app/(app)/inbox/page.tsx',
  'app/(app)/inbox/page.tsx',
  'components/ui/PageHeader.tsx',
  'app/(app)/design-system/page.tsx',
];

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
  const short = rel.replace(/^src\//, '');
  if (ALLOW_PLAIN.some((a) => short === a || short.endsWith(a))) continue;
  const text = readFileSync(file, 'utf8');
  if (!text.includes('PageHeader')) continue;
  if (/variant=["']plain["']/.test(text)) hits.push(short);
}

if (hits.length) {
  console.error('PageHeader variant="plain" em página de produto (use revive padrão):\n');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log('OK — PageHeader revive ou sem variant plain em produto');

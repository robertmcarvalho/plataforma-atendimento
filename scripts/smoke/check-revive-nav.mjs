#!/usr/bin/env node
/**
 * Falha se CommercialSubNav (tabs border-b) ainda é usado — nav comercial deve estar na Sidebar.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');

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
  const text = readFileSync(file, 'utf8');
  if (text.includes('CommercialSubNav')) hits.push(rel);
}

if (hits.length) {
  console.error('CommercialSubNav ainda importado (use Sidebar comercial):\n');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log('OK — sem CommercialSubNav');

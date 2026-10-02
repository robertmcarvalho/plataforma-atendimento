#!/usr/bin/env node
/**
 * Falha se <button> usar estilos primários legados sem import de Button.
 * Uso: node scripts/check-buttons.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');

const LEGACY = [
  /hover:bg-primary-glow/,
  /reviveActionButtonStyles/,
  /<button[^>]*className=[^>]*bg-primary[^>]*px-3/,
];

const ALLOWLIST = new Set([
  'components/ui/button.tsx',
  'app/(app)/design-system/page.tsx',
]);

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
  if (!text.includes('<button')) continue;
  const usesLegacy = LEGACY.some((re) => re.test(text));
  const usesButton = text.includes("from '@/components/ui/button'") || text.includes('from "@/components/ui/button"');
  if (usesLegacy && !usesButton) hits.push(key);
}

if (hits.length) {
  console.error('Raw buttons with legacy primary styles (migrate to Button):\n');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log('OK — legacy primary button patterns only in Button-importing files');

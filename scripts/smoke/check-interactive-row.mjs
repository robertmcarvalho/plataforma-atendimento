#!/usr/bin/env node
/**
 * Falha se linhas selecionáveis usarem bg-surface-hover sem interactiveRow.
 * Uso: node scripts/check-interactive-row.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');

const LEGACY_PATTERNS = [
  /<tr[^>]*className=[^>]*(hover:bg-surface-hover|bg-surface-hover)/,
  /hover:bg-surface-hover\/60/,
  /active && ['"]bg-surface-hover['"]/,
  /hover:bg-surface-hover['"]\s*,\s*active/,
  /className=\{cn\([^)]*hover:bg-surface-hover[^)]*w-full/,
  /className=\{cn\([^)]*w-full[^)]*hover:bg-surface-hover/,
];

const ALLOWLIST = new Set(['components/shell/Sidebar.tsx']);

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
  const usesLegacy = LEGACY_PATTERNS.some((re) => re.test(text));
  const usesInteractiveRow =
    text.includes('interactiveRow') || text.includes('interactiveNavItem') || text.includes('InboxConversationRow');

  if (usesLegacy && !usesInteractiveRow) {
    hits.push(key);
  }
}

if (hits.length) {
  console.error('Selectable rows still use legacy surface-hover without interactiveRow:\n');
  for (const h of hits) console.error(`  ${h}`);
  process.exit(1);
}

console.log('OK — selectable rows use interactiveRow or no legacy hover pattern');

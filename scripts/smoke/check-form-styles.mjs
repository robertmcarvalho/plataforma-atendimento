#!/usr/bin/env node
/**
 * Falha se ainda existirem inputs raw com o padrão legado (fora de exceções).
 * Uso: node scripts/check-form-styles.mjs
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', 'apps', 'web', 'src');
const FORBIDDEN = [
  /h-10 w-full rounded-md border border-border bg-background/,
  /h-9 w-full rounded-md border border-border bg-background/,
  /h-9 w-full rounded-md border border-input bg-background/,
  /rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-primary/,
  /mt-1 w-full rounded-md border border-border bg-background/,
  /w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none/,
  /mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none/,
  /rounded-md border border-border bg-surface px-3 py-2 text-xs font-medium text-muted-foreground/,
  /rounded-md border border-border bg-surface px-3 py-2 text-xs outline-none/,
  /border border-border bg-surface px-3 py-2 text-sm outline-none/,
  /className="input(?: |")/,
];
const ALLOWLIST = new Set([
  'components/ui/input.tsx',
  'app/(app)/design-system/page.tsx',
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(tsx|ts|jsx|js)$/.test(name)) out.push(p);
  }
  return out;
}

function classNameRange(segment, classNameStart) {
  const after = segment.slice(classNameStart);
  if (after.startsWith('className="')) {
    const end = after.indexOf('"', 'className="'.length);
    return end === -1 ? null : { start: classNameStart, end: classNameStart + end + 1 };
  }
  if (after.startsWith('className={')) {
    let depth = 0;
    for (let i = 'className='.length; i < after.length; i++) {
      const ch = after[i];
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) return { start: classNameStart, end: classNameStart + i + 1 };
      }
    }
  }
  return null;
}

/** className legado pertence a input/select/textarea (suporta props multiline). */
function isFormElementClassName(text, matchIndex) {
  const windowStart = Math.max(0, matchIndex - 1200);
  const windowEnd = Math.min(text.length, matchIndex + 120);
  const window = text.slice(windowStart, windowEnd);
  const relMatch = matchIndex - windowStart;

  const tags = [...window.matchAll(/<(input|select|textarea)\b/g)];
  for (let i = tags.length - 1; i >= 0; i--) {
    const tagStart = tags[i].index;
    const segment = window.slice(tagStart);
    const classNameStart = segment.search(/className=/);
    if (classNameStart === -1) continue;

    const range = classNameRange(segment, classNameStart);
    if (!range) continue;
    if (relMatch < tagStart + range.start || relMatch >= tagStart + range.end) continue;

    const between = segment.slice(0, classNameStart);
    const cleaned = between.replace(/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/g, '');
    return !cleaned.includes('>');
  }
  return false;
}

function fileHasLegacyFormInputs(text) {
  for (const re of FORBIDDEN) {
    const globalRe = new RegExp(re.source, 'g');
    let match;
    while ((match = globalRe.exec(text)) !== null) {
      if (isFormElementClassName(text, match.index)) return true;
    }
  }
  return false;
}

const hits = [];
for (const file of walk(ROOT)) {
  const rel = relative(join(import.meta.dirname, '..', '..', 'apps', 'web'), file).replace(/\\/g, '/');
  if (!rel.startsWith('src/')) continue;
  const key = rel.slice('src/'.length);
  if (ALLOWLIST.has(key)) continue;
  const text = readFileSync(file, 'utf8');
  if (fileHasLegacyFormInputs(text)) hits.push({ file: key });
}

if (hits.length) {
  console.error('Legacy form input styles found:\n');
  for (const h of hits) console.error(`  ${h.file}`);
  process.exit(1);
}

console.log('OK — no legacy form input class patterns in apps/web/src');

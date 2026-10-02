#!/usr/bin/env node
/**
 * Falha se encontrar cores hex/rgb/hsl fixas em TS/TSX (exceto allowlist).
 * Uso: node apps/web/scripts/lint-no-hardcoded-colors.mjs
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.join(import.meta.dirname, '..', 'src');
const ALLOW_FILES = [
  'lib/commercial/commercialTags.ts',
  'lib/commercial/commercialDashboardMetrics.ts',
  'components/commercial/CommercialSettingsPage.tsx',
];
const ALLOW = [
  /chart/i,
  /gradient/i,
  /transparent/i,
  /currentColor/i,
  /inherit/i,
  /stageColor|newStageColor|color:\s*['"]#/,
];

const PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/g,
  /\brgb\(\s*\d/g,
  /\bhsl\(\s*\d/g,
];

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(ent.name)) out.push(p);
  }
  return out;
}

const hits = [];
for (const file of walk(ROOT)) {
  const rel = path.relative(path.join(import.meta.dirname, '..'), file).replace(/\\/g, '/');
  if (rel.includes('design-system')) continue;
  if (ALLOW_FILES.some((a) => rel.endsWith(a))) continue;
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (ALLOW.some((re) => re.test(line))) return;
    for (const pat of PATTERNS) {
      pat.lastIndex = 0;
      if (pat.test(line)) {
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 120)}`);
        break;
      }
    }
  });
}

if (hits.length) {
  console.error('Hardcoded colors found:\n' + hits.slice(0, 40).join('\n'));
  if (hits.length > 40) console.error(`... and ${hits.length - 40} more`);
  process.exit(1);
}
console.log('lint-no-hardcoded-colors: OK');

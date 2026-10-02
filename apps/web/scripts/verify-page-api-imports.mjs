import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/app');
const apiModules = [
  'cadastroPageApi',
  'settingsPageApi',
  'campaignsPageApi',
  'automationsPageApi',
  'contactsPageApi',
  'leaderPortalPageApi',
  'inboxPageApi',
  'dashboardApi',
  'platformPageApi',
  'operationalAuditApi',
];

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === 'page.tsx') out.push(full);
  }
  return out;
}

let failed = false;
for (const file of walk(appDir)) {
  const src = fs.readFileSync(file, 'utf8');
  for (const sym of apiModules) {
    if (!src.includes(`${sym}.`)) continue;
    const importRe = new RegExp(`import\\s*\\{[^}]*\\b${sym}\\b[^}]*\\}\\s*from`);
    if (!importRe.test(src)) {
      console.error('MISSING IMPORT:', path.relative(appDir, file), 'uses', sym);
      failed = true;
    }
  }
}

if (failed) process.exit(1);
console.log('All page.tsx API imports OK');

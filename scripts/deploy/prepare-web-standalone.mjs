import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..', '..');
const webRoot = path.join(root, 'apps', 'web');
const distDir = process.env.WEB_NEXT_DIST_DIR || '.next_local';

// Next may emit either:
// - .next_local/standalone/apps/web/ (nested, common on some Windows/monorepo layouts)
// - .next_local/standalone/ with server.js at root (typical Linux / Docker)
const nestedStandaloneWeb = path.join(webRoot, distDir, 'standalone', 'apps', 'web');
const flatStandalone = path.join(webRoot, distDir, 'standalone');

let standaloneRoot = null;
if (existsSync(path.join(nestedStandaloneWeb, 'server.js'))) {
  standaloneRoot = nestedStandaloneWeb;
} else if (existsSync(path.join(flatStandalone, 'server.js'))) {
  standaloneRoot = flatStandalone;
}

if (!standaloneRoot) {
  console.log('WEB_STANDALONE_SKIPPED');
  process.exit(0);
}

// Next standalone resolves static from `${cwd}/${distDir}/static` relative to server cwd.
const standaloneDistRoot = path.join(standaloneRoot, distDir);
const sourceStatic = path.join(webRoot, distDir, 'static');
const targetStatic = path.join(standaloneDistRoot, 'static');
const sourcePublic = path.join(webRoot, 'public');
const targetPublic = path.join(standaloneRoot, 'public');

mkdirSync(standaloneDistRoot, { recursive: true });

if (existsSync(sourceStatic)) {
  cpSync(sourceStatic, targetStatic, { recursive: true, force: true });
}

if (existsSync(sourcePublic)) {
  cpSync(sourcePublic, targetPublic, { recursive: true, force: true });
}

console.log('WEB_STANDALONE_PREPARED');

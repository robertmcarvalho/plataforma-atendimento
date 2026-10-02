import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const webRoot = path.join(root, 'apps', 'web');

// Must match apps/web/next.config.ts distDir default
const distDir = process.env.WEB_NEXT_DIST_DIR || '.next_local';
const manifestPath = path.join(webRoot, distDir, 'prerender-manifest.json');

// Next start expects this file. Some Windows/OneDrive setups end up with an incomplete build
// (spawn EPERM) where BUILD_ID exists but prerender-manifest doesn't. An empty manifest is safe
// when the app doesn't rely on SSG prerender routes locally.
if (!existsSync(manifestPath)) {
  mkdirSync(path.dirname(manifestPath), { recursive: true });
  const minimal = {
    version: 4,
    routes: {},
    dynamicRoutes: {},
    notFoundRoutes: [],
    // Next expects these keys to exist even if preview mode isn't used.
    preview: {
      previewModeId: crypto.randomBytes(16).toString('hex'),
      previewModeSigningKey: crypto.randomBytes(32).toString('hex'),
      previewModeEncryptionKey: crypto.randomBytes(32).toString('hex'),
    },
  };
  writeFileSync(manifestPath, JSON.stringify(minimal, null, 2), 'utf8');
  // eslint-disable-next-line no-console
  console.log(`WROTE_PRERENDER_MANIFEST ${path.relative(root, manifestPath)}`);
}

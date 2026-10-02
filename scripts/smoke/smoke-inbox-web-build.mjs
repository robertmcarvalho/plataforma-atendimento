/**
 * Smoke: garante que o bundle do Next inclui /inbox sem erro de compilação.
 * Executa `next build` no workspace web (pode levar ~1 min).
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const webDir = path.join(process.cwd(), 'apps', 'web');
const result = spawnSync('npm', ['run', 'build'], {
  cwd: webDir,
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, CI: 'true' },
});

if (result.status !== 0) {
  console.error('FAIL: apps/web build (inbox e demais rotas)');
  process.exit(result.status || 1);
}

console.log('PASS: smoke-inbox-web-build (next build OK, rota /inbox compilada)');

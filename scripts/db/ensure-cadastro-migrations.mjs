/**
 * Aplica colunas de cadastro em pharmacies (013) e drivers (004,006,009,10).
 * Uso: npm run db:ensure:cadastros
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const node = process.execPath;

function run(rel) {
  const script = path.join(scriptDir, rel);
  const r = spawnSync(node, [script], { stdio: "inherit", cwd: root });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("ensure-pharmacy-address-contacts.mjs");
run("ensure-driver-cadastro-columns.mjs");

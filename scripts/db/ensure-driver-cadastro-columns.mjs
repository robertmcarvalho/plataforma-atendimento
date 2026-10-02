/**
 * Reaplica idempotentemente migrações de colunas de drivers usadas pelo cadastro:
 * 004_geo, 006_driver_pix_key, 009_driver_work_schedule, 010_driver_operational_columns.
 * Uso: npm run db:ensure:driver-cadastro
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readDbUrl } from "../lib/readDbUrl.mjs";
import { execSqlStatements } from "../lib/execSqlStatements.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const mig = (...parts) => fs.readFileSync(path.join(root, "supabase", "migrations", ...parts), "utf8");

const files = [
  "004_geo.sql",
  "006_driver_pix_key.sql",
  "009_driver_work_schedule.sql",
  "010_driver_operational_columns.sql",
];

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("begin");
  for (const f of files) {
    await execSqlStatements(client, mig(f));
    console.log("OK:", f);
  }
  await client.query("commit");
  console.log("OK: driver cadastro migrations aplicadas (idempotente).");
} catch (e) {
  await client.query("rollback");
  throw e;
} finally {
  await client.end();
}

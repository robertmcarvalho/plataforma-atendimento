/**
 * Aplica supabase/migrations/013_pharmacy_address_and_contacts.sql (idempotente).
 * Uso: npm run db:ensure:pharmacy-address
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readDbUrl } from "../lib/readDbUrl.mjs";
import { execSqlStatements } from "../lib/execSqlStatements.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const migrationPath = path.join(root, "supabase", "migrations", "013_pharmacy_address_and_contacts.sql");

const sql = fs.readFileSync(migrationPath, "utf8");

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("begin");
  await execSqlStatements(client, sql);
  await client.query("commit");
  console.log("OK: 013_pharmacy_address_and_contacts aplicada.");
} catch (e) {
  await client.query("rollback");
  throw e;
} finally {
  await client.end();
}

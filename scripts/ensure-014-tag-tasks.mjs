import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { readDbUrl } from "./lib/readDbUrl.mjs";
import { execSqlStatements } from "./lib/execSqlStatements.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const migrationPaths = [
  path.join(root, "supabase", "migrations", "012_conversation_tag_catalog.sql"),
  path.join(root, "supabase", "migrations", "014_tag_tones_and_pending_tasks.sql"),
];

const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query("begin");
  for (const migrationPath of migrationPaths) {
    const sql = fs.readFileSync(migrationPath, "utf8");
    await execSqlStatements(client, sql);
    console.log(`OK: ${path.basename(migrationPath)} aplicada.`);
  }
  await client.query("commit");
  console.log("OK: migrações 012 + 014 aplicadas.");
} catch (e) {
  await client.query("rollback");
  throw e;
} finally {
  await client.end();
}

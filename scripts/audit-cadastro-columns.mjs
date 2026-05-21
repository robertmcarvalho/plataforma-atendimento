/**
 * Lista colunas em public.pharmacies e public.drivers (information_schema).
 * Uso: npm run db:audit:cadastros
 */
import pg from "pg";
import { readDbUrl } from "./lib/readDbUrl.mjs";

try {
  const client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();

  for (const table of ["pharmacies", "drivers"]) {
    const { rows } = await client.query(
      `select column_name from information_schema.columns
       where table_schema = 'public' and table_name = $1
       order by ordinal_position`,
      [table]
    );
    console.log(`--- ${table} (${rows.length} cols) ---`);
    console.log(rows.map((r) => r.column_name).join(", "));
  }

  await client.end();
} catch (e) {
  if (e instanceof Error && e.message.includes("Missing SUPABASE_DB_URL")) {
    console.log("SKIP_AUDIT_NO_DB_URL:", e.message);
    process.exit(0);
  }
  console.error(e);
  process.exit(1);
}

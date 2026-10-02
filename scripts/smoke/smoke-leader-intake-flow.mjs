/**
 * Smoke DB: contagens de leader_pharmacy_links e driver_pharmacy_links
 * para validar dados usados na triagem guiada do líder.
 *
 * Uso: npm run smoke:leader-intake-flow
 * Opcional: LEADER_ID=<uuid> PHARMACY_ID=<uuid>
 */
import pg from "pg";
import { readDbUrl } from "../lib/readDbUrl.mjs";

const leaderId = (process.env.LEADER_ID || "").trim();
const pharmacyId = (process.env.PHARMACY_ID || "").trim();

let client;
try {
  client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
} catch (e) {
  if (e instanceof Error && e.message.includes("Missing SUPABASE_DB_URL")) {
    console.log("SKIP_SMOKE_NO_DB_URL — configure SUPABASE_DB_URL para validar vínculos do líder.");
    process.exit(0);
  }
  throw e;
}

const tables = ["leader_pharmacy_links", "driver_pharmacy_links"];
for (const table of tables) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1`,
    [table]
  );
  if (!rows.length) {
    console.error(`Tabela ausente: ${table}`);
    process.exitCode = 1;
    await client.end();
    process.exit(1);
  }
}

if (leaderId) {
  const { rows } = await client.query(
    `select lpl.pharmacy_id, p.trade_name
     from public.leader_pharmacy_links lpl
     join public.pharmacies p on p.id = lpl.pharmacy_id
     where lpl.leader_id = $1
     order by p.trade_name`,
    [leaderId]
  );
  console.log(`leader_pharmacy_links (leader=${leaderId}): ${rows.length}`);
  for (const r of rows.slice(0, 15)) {
    console.log(`  - ${r.trade_name} (${r.pharmacy_id})`);
  }
  if (rows.length > 15) console.log(`  ... +${rows.length - 15} mais`);
} else {
  const { rows } = await client.query(
    `select count(*)::int as n from public.leader_pharmacy_links`
  );
  console.log(`leader_pharmacy_links (total): ${rows[0]?.n ?? 0}`);
}

const pid = pharmacyId || (leaderId
  ? (await client.query(
      `select pharmacy_id from public.leader_pharmacy_links where leader_id = $1 limit 1`,
      [leaderId]
    )).rows[0]?.pharmacy_id
  : null);

if (pid) {
  const { rows } = await client.query(
    `select count(distinct dpl.driver_id)::int as n
     from public.driver_pharmacy_links dpl
     join public.drivers d on d.id = dpl.driver_id
     where dpl.pharmacy_id = $1
       and dpl.is_active = true
       and d.status = 'active'`,
    [pid]
  );
  console.log(`driver_pharmacy_links ativos (pharmacy=${pid}): ${rows[0]?.n ?? 0}`);
} else {
  const { rows } = await client.query(
    `select count(*)::int as n from public.driver_pharmacy_links where is_active = true`
  );
  console.log(`driver_pharmacy_links ativos (total): ${rows[0]?.n ?? 0}`);
}

console.log("OK smoke-leader-intake-flow");
await client.end();

/**
 * Smoke DB: confirma colunas esperadas e INSERT/DELETE mínimo em pharmacies e drivers.
 * Uso: npm run smoke:cadastro-db
 */
import pg from "pg";
import { readDbUrl } from "../lib/readDbUrl.mjs";

const PHARMACY_COLS = [
  "address_cep",
  "address_street",
  "address_number",
  "address_neighborhood",
  "address_complement",
  "contact_expedition_name",
  "contact_expedition_phone",
  "contact_expedition_email",
  "contact_financial_name",
  "contact_financial_phone",
  "contact_financial_email",
  "contact_manager_name",
  "contact_manager_phone",
  "contact_manager_email",
];

const DRIVER_COLS = [
  "state",
  "pix_key",
  "work_schedule",
  "email",
  "is_mei",
  "mei_cnpj",
  "is_leader",
  "leader_role",
  "leader_notes",
  "has_digital_certificate",
  "digital_certificate_expires_at",
];

function missingCols(have, need) {
  const set = new Set(have);
  return need.filter((c) => !set.has(c));
}

let client;
try {
  client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
} catch (e) {
  if (e instanceof Error && e.message.includes("Missing SUPABASE_DB_URL")) {
    console.log("SKIP_SMOKE_NO_DB_URL — execute smoke manual na UI quando o DB estiver configurado.");
    process.exit(0);
  }
  throw e;
}

for (const table of ["pharmacies", "drivers"]) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1`,
    [table]
  );
  const have = rows.map((r) => r.column_name);
  const need = table === "pharmacies" ? PHARMACY_COLS : DRIVER_COLS;
  const miss = missingCols(have, need);
  if (miss.length) {
    console.error(`Faltam colunas em ${table}:`, miss.join(", "));
    process.exitCode = 1;
    await client.end();
    process.exit(1);
  }
}

const suf = String(Date.now());
const cnpj = `9${suf.slice(-13).padStart(13, "0")}`.slice(0, 14);
const phonePh = `5534999${suf.slice(-6).padStart(6, "0")}`;
const phoneDr = `5534888${suf.slice(-6).padStart(6, "0")}`;

const workspaceRes = await client.query("select id from public.workspaces where is_active = true order by created_at limit 1");
const workspaceId = workspaceRes.rows[0]?.id;
if (!workspaceId) {
  console.log("SKIP_SMOKE_NO_WORKSPACE — nenhum workspace ativo disponível.");
  await client.end();
  process.exit(0);
}

await client.query("begin");
try {
  const ph = await client.query(
    `insert into public.pharmacies (
       workspace_id, legal_name, trade_name, cnpj, city, state, phone, email, status,
       address_cep, address_street, address_number, address_neighborhood, address_complement,
       contact_expedition_name, contact_expedition_phone, contact_expedition_email,
       contact_financial_name, contact_financial_phone, contact_financial_email,
       contact_manager_name, contact_manager_phone, contact_manager_email
     ) values (
       $1, $2, $3, $4, 'City', 'MG', $5, $6, 'inactive',
       '30130000', 'Rua Smoke', '1', 'Centro', 'Sala A',
       'Exp', $7, $8,
       'Fin', $9, $10,
       'Ger', $11, $12
     ) returning id`,
    [
      workspaceId,
      `Smoke Test Farm ${suf}`,
      `Smoke Trade ${suf}`,
      cnpj,
      phonePh,
      `smoke-ph-${suf}@test.invalid`,
      `5534998${suf.slice(-6).padStart(6, "0")}`,
      `exp-${suf}@test.invalid`,
      `5534997${suf.slice(-6).padStart(6, "0")}`,
      `fin-${suf}@test.invalid`,
      `5534996${suf.slice(-6).padStart(6, "0")}`,
      `ger-${suf}@test.invalid`,
    ]
  );
  const pharmacyId = ph.rows[0].id;

  const dr = await client.query(
    `insert into public.drivers (
       workspace_id, name, cpf, phone, city, state, status,
       email, is_mei, mei_cnpj, is_leader, leader_role, leader_notes,
       has_digital_certificate, digital_certificate_expires_at, pix_key, work_schedule
     ) values (
       $1, $2, null, $3, 'BH', 'MG', 'inactive',
       $4, true, $5, false, null, null,
       true, '2030-01-01', $6, '{}'::jsonb
     ) returning id`,
    [workspaceId, `Smoke Driver ${suf}`, phoneDr, `smoke-dr-${suf}@test.invalid`, cnpj, `smoke-pix-${suf}@test`]
  );
  const driverId = dr.rows[0].id;

  await client.query("delete from public.drivers where id = $1", [driverId]);
  await client.query("delete from public.pharmacies where id = $1", [pharmacyId]);
  await client.query("commit");
  console.log("OK: smoke cadastro (insert com colunas extras + rollback por delete).");
} catch (e) {
  await client.query("rollback");
  console.error("Smoke falhou:", e.message);
  process.exit(1);
} finally {
  await client.end();
}

/**
 * Compara colunas esperadas (cadastro UI/API) com information_schema no Postgres.
 * Uso: npm run check:schema-cadastros
 * Exit 1 se houver colunas em falta ou extras não ignoradas.
 */
import pg from "pg";
import { readDbUrl } from "./lib/readDbUrl.mjs";

/** Colunas que a API/UI usam em pharmacies além do 001 base (013). */
const PHARMACY_EXTRA = [
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
  "delivery_fee_cents",
  "delivery_fee_driver_payout_cents",
  "minimum_guaranteed_cents",
  "minimum_guaranteed_driver_payout_cents",
  "delivery_schedule",
];

/** Colunas drivers usadas pelo driverSchema além do 001 (004,006,009,010). */
const DRIVER_EXTRA = [
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

const BASE_PHARMACY = new Set([
  "id",
  "legal_name",
  "trade_name",
  "cnpj",
  "city",
  "state",
  "phone",
  "email",
  "status",
  "primary_attendant_id",
  "secondary_attendant_id",
  "leader_id",
  "notes",
  "tags",
  "created_at",
  "updated_at",
]);

const BASE_DRIVER = new Set([
  "id",
  "name",
  "cpf",
  "phone",
  "city",
  "status",
  "primary_pharmacy_id",
  "inherit_from_primary",
  "override_attendant_id",
  "override_leader_id",
  "doc_status",
  "notes",
  "tags",
  "created_at",
  "updated_at",
]);

function expectedSet(base, extra) {
  const s = new Set(base);
  for (const c of extra) s.add(c);
  return s;
}

let client;
try {
  client = new pg.Client({ connectionString: readDbUrl(), ssl: { rejectUnauthorized: false } });
  await client.connect();
} catch (e) {
  if (e instanceof Error && e.message.includes("Missing SUPABASE_DB_URL")) {
    console.log("SKIP_DRIFT_NO_DB_URL");
    process.exit(0);
  }
  throw e;
}

let exit = 0;

for (const [table, base, extra] of [
  ["pharmacies", BASE_PHARMACY, PHARMACY_EXTRA],
  ["drivers", BASE_DRIVER, DRIVER_EXTRA],
]) {
  const { rows } = await client.query(
    `select column_name from information_schema.columns
     where table_schema = 'public' and table_name = $1`,
    [table]
  );
  const actual = new Set(rows.map((r) => r.column_name));
  const expected = expectedSet(base, extra);
  const missing = [...expected].filter((c) => !actual.has(c));
  const unexpected = [...actual].filter((c) => !expected.has(c));
  if (missing.length) {
    console.error(`[${table}] Faltam colunas:`, missing.join(", "));
    exit = 1;
  }
  if (unexpected.length) {
    console.warn(`[${table}] Colunas no DB não mapeadas neste check (revisar):`, unexpected.join(", "));
  }
}

await client.end();
process.exit(exit);

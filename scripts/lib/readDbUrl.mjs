import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..", "..");

dotenv.config({ path: path.join(root, ".env") });
dotenv.config({ path: path.join(root, "apps", "api-service", ".env") });

/**
 * Same resolution order as scripts/ensure-supabase-chat-enhancements.mjs,
 * plus loading root and apps/api-service/.env via dotenv.
 * @returns {string}
 */
export function readDbUrl() {
  const envUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL;
  if (envUrl) return envUrl.trim();

  const supabaseUrl = (process.env.SUPABASE_URL || "").trim();
  const dbPassword = (process.env.SUPABASE_DB_PASSWORD || "").trim();
  if (supabaseUrl && dbPassword) {
    try {
      const u = new URL(supabaseUrl);
      const ref = (u.hostname || "").split(".")[0];
      if (ref) {
        const enc = encodeURIComponent(dbPassword);
        return `postgresql://postgres:${enc}@db.${ref}.supabase.co:5432/postgres`;
      }
    } catch {
      // ignore
    }
  }

  const secretPath = path.join(root, ".secrets", "supabase-db-url.txt");
  if (fs.existsSync(secretPath)) {
    const value = fs.readFileSync(secretPath, "utf8").trim();
    if (value) return value;
  }

  throw new Error(
    "Missing SUPABASE_DB_URL. Set SUPABASE_DB_URL, or set SUPABASE_URL + SUPABASE_DB_PASSWORD, or create .secrets/supabase-db-url.txt (gitignored)."
  );
}

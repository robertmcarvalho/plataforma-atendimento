import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import pg from 'pg';

export const LEGACY_REF = 'ojzzxqqatqncchnspkch';
export const PROD_REF = 'omhlbavfsttwcnybzvcd';

export function loadEnvFile(filePath) {
  const out = {};
  for (const rawLine of readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

export function assertRef(url, expectedRef, label) {
  if (!url.includes(expectedRef)) {
    throw new Error(`${label} deve usar ref ${expectedRef}`);
  }
}

export async function connectPg(connectionString, label) {
  const client = new pg.Client({ connectionString, ssl: { rejectUnauthorized: false } });
  try {
    await client.connect();
    return client;
  } catch (e) {
    throw new Error(
      `${label}: não conectou (${e.message}). ` +
        (label.includes('legado')
          ? 'Reative o projeto ojzzx no Supabase e preencha .secrets/legacy-db-url.txt'
          : 'Verifique .secrets/production-db-url.txt')
    );
  }
}

export async function tableCount(client, table) {
  try {
    const { rows } = await client.query(`SELECT COUNT(*)::int AS c FROM public.${table}`);
    return rows[0].c;
  } catch {
    return null;
  }
}

export async function snapshot(client, tables) {
  const counts = {};
  for (const t of tables) counts[t] = await tableCount(client, t);
  return counts;
}

export async function resolveWorkspaceMap(src, dst) {
  const srcRows = (await src.query(`SELECT id, slug FROM public.workspaces ORDER BY slug`)).rows;
  const dstRows = (await dst.query(`SELECT id, slug FROM public.workspaces ORDER BY slug`)).rows;
  const dstBySlug = new Map(dstRows.map((r) => [r.slug, r.id]));
  const map = new Map();
  for (const row of srcRows) {
    const targetId = dstBySlug.get(row.slug);
    if (targetId) map.set(row.id, targetId);
  }
  if (!map.size) throw new Error('Nenhum workspace com slug correspondente entre legado e produção.');
  return map;
}

export function remapUuid(value, workspaceMap) {
  if (!value) return value;
  return workspaceMap.get(value) || value;
}

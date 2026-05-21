/**
 * Cria/descobre projeto Supabase de staging via Management API.
 *
 * Preparação:
 *   New-Item -ItemType Directory -Force .secrets
 *   Set-Content .secrets/supabase-access-token.txt "sbp_..."
 *   Set-Content .secrets/supabase-org-slug.txt "sua-org-slug"
 *
 * Listar organizações:
 *   npm run staging:supabase:list-orgs
 *
 * Criar/confirmar staging:
 *   $env:CONFIRM_CREATE_SUPABASE_STAGING="true"
 *   npm run staging:supabase:create -- --create
 *
 * Atualizar connection string pelo pooler:
 *   node scripts/create-supabase-staging-project.mjs --refresh-db-url
 *
 * Atualizar env de API staging:
 *   node scripts/create-supabase-staging-project.mjs --refresh-api-env
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const secretsDir = path.join(repoRoot, '.secrets');
const apiBase = 'https://api.supabase.com/v1';
const shouldCreate = process.argv.includes('--create');
const shouldRefreshDbUrl = process.argv.includes('--refresh-db-url');
const shouldRefreshApiEnv = process.argv.includes('--refresh-api-env');
const shouldListOrgs = process.argv.includes('--list-orgs');
const shouldListProjects = process.argv.includes('--list-projects');

function readSecretFile(name) {
  const fullPath = path.join(secretsDir, name);
  if (!fs.existsSync(fullPath)) return '';
  return fs.readFileSync(fullPath, 'utf8').trim();
}

function writeSecretFile(name, value) {
  fs.mkdirSync(secretsDir, { recursive: true });
  fs.writeFileSync(path.join(secretsDir, name), `${value}\n`, { encoding: 'utf8' });
}

function readToken() {
  return (process.env.SUPABASE_ACCESS_TOKEN || readSecretFile('supabase-access-token.txt')).trim();
}

function readOrgSlug() {
  return (process.env.SUPABASE_ORG_SLUG || readSecretFile('supabase-org-slug.txt')).trim();
}

function generateDbPassword() {
  return `Stg@${crypto.randomBytes(24).toString('base64url')}!`;
}

function readOrCreateDbPassword() {
  const existing = (process.env.STAGING_DB_PASSWORD || readSecretFile('staging-db-password.txt')).trim();
  if (existing) return existing;
  const generated = generateDbPassword();
  writeSecretFile('staging-db-password.txt', generated);
  return generated;
}

async function supabaseFetch(pathname, init = {}) {
  const token = readToken();
  if (!token) {
    throw new Error(
      'Token Supabase ausente. Crie um access token no Supabase e salve em .secrets/supabase-access-token.txt'
    );
  }

  const res = await fetch(`${apiBase}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    throw new Error(`${init.method || 'GET'} ${pathname} -> ${res.status}: ${JSON.stringify(body)}`);
  }
  return body;
}

async function listOrganizations() {
  const orgs = await supabaseFetch('/organizations');
  console.log(JSON.stringify(
    (orgs || []).map((org) => ({
      id: org.id,
      slug: org.slug,
      name: org.name,
    })),
    null,
    2
  ));
}

async function listProjects(organizationSlug) {
  const projects = await supabaseFetch(`/organizations/${encodeURIComponent(organizationSlug)}/projects`);
  const rows = Array.isArray(projects?.projects) ? projects.projects : Array.isArray(projects) ? projects : [];
  console.log(JSON.stringify(
    rows.map((project) => ({
      ref: project.ref,
      name: project.name,
      region: project.region,
      status: project.status,
      is_branch: project.is_branch,
    })),
    null,
    2
  ));
  return rows;
}

async function createProject(organizationSlug) {
  if (process.env.CONFIRM_CREATE_SUPABASE_STAGING !== 'true') {
    throw new Error('Execução bloqueada: defina CONFIRM_CREATE_SUPABASE_STAGING=true.');
  }

  const projectName = process.env.STAGING_PROJECT_NAME || 'plataforma-atendimento-staging';
  const regionCode = process.env.STAGING_REGION_SELECTION_CODE || 'americas';
  const instanceSize = String(process.env.STAGING_INSTANCE_SIZE || '').trim();
  const dbPassword = readOrCreateDbPassword();

  const existingProjects = await supabaseFetch(`/organizations/${encodeURIComponent(organizationSlug)}/projects`);
  const rows = Array.isArray(existingProjects?.projects) ? existingProjects.projects : Array.isArray(existingProjects) ? existingProjects : [];
  const existing = rows.find((project) => String(project.name || '').toLowerCase() === projectName.toLowerCase());
  if (existing?.ref) {
    persistStagingTarget(existing.ref, dbPassword);
    console.log(JSON.stringify({ ok: true, reused_existing: true, ref: existing.ref, name: existing.name }, null, 2));
    return existing;
  }

  const payload = {
    name: projectName,
    organization_slug: organizationSlug,
    db_pass: dbPassword,
    region_selection: {
      type: regionCode.includes('-') ? 'specific' : 'smartGroup',
      code: regionCode,
    },
  };
  if (instanceSize) {
    payload.desired_instance_size = instanceSize;
  }

  const created = await supabaseFetch('/projects', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

  persistStagingTarget(created.ref, dbPassword);
  console.log(JSON.stringify(
    {
      ok: true,
      created: true,
      ref: created.ref,
      name: created.name,
      status: created.status,
      region: created.region,
      next: 'Aguarde o projeto ficar healthy antes de rodar migrations.',
    },
    null,
    2
  ));
  return created;
}

function persistStagingTarget(ref, dbPassword) {
  if (!ref) throw new Error('Projeto Supabase sem ref retornado.');
  const encodedPassword = encodeURIComponent(dbPassword);
  const directDbUrl = `postgresql://postgres:${encodedPassword}@db.${ref}.supabase.co:5432/postgres`;
  writeSecretFile('staging-supabase-project-ref.txt', ref);
  writeSecretFile('staging-supabase-db-url.txt', directDbUrl);
}

async function refreshPoolerDbUrl() {
  const ref = readSecretFile('staging-supabase-project-ref.txt') || process.env.STAGING_SUPABASE_PROJECT_REF || '';
  if (!ref) throw new Error('Project ref ausente. Crie o staging primeiro.');
  const dbPassword = readOrCreateDbPassword();
  const poolers = await supabaseFetch(`/projects/${encodeURIComponent(ref)}/config/database/pooler`);
  const primary = (Array.isArray(poolers) ? poolers : []).find((row) => row.database_type === 'PRIMARY') || poolers?.[0];
  if (!primary?.connection_string && !primary?.connectionString) {
    throw new Error('Pooler connection string não retornada pela Management API.');
  }
  const raw = String(primary.connection_string || primary.connectionString);
  const url = new URL(raw);
  url.password = encodeURIComponent(dbPassword);
  writeSecretFile('staging-supabase-db-url.txt', url.toString());
  console.log(JSON.stringify({
    ok: true,
    ref,
    db_host: primary.db_host,
    db_port: primary.db_port,
    db_user: primary.db_user,
    pool_mode: primary.pool_mode,
    saved: '.secrets/staging-supabase-db-url.txt',
  }, null, 2));
}

async function refreshApiEnv() {
  const ref = readSecretFile('staging-supabase-project-ref.txt') || process.env.STAGING_SUPABASE_PROJECT_REF || '';
  if (!ref) throw new Error('Project ref ausente. Crie o staging primeiro.');
  const keys = await supabaseFetch(`/projects/${encodeURIComponent(ref)}/api-keys?reveal=true`);
  const rows = Array.isArray(keys) ? keys : [];
  const service = rows.find((row) => String(row.name || row.type || '').toLowerCase().includes('service_role'));
  const anon = rows.find((row) => String(row.name || row.type || '').toLowerCase().includes('anon'));
  if (!service?.api_key) throw new Error('Service role key não retornada pela Management API.');
  if (!anon?.api_key) throw new Error('Anon key não retornada pela Management API.');

  const supabaseUrl = `https://${ref}.supabase.co`;
  const content = [
    `SUPABASE_URL=${supabaseUrl}`,
    `SUPABASE_SERVICE_ROLE_KEY=${service.api_key}`,
    `NEXT_PUBLIC_SUPABASE_URL=${supabaseUrl}`,
    `NEXT_PUBLIC_SUPABASE_ANON_KEY=${anon.api_key}`,
    '',
  ].join('\n');
  writeSecretFile('staging-api.env', content.trim());
  console.log(JSON.stringify({
    ok: true,
    ref,
    supabase_url: supabaseUrl,
    saved: '.secrets/staging-api.env',
  }, null, 2));
}

async function main() {
  if (shouldListOrgs) {
    await listOrganizations();
    return;
  }

  const organizationSlug = readOrgSlug();
  if (!organizationSlug) {
    throw new Error('Organization slug ausente. Rode --list-orgs e salve o slug em .secrets/supabase-org-slug.txt');
  }

  if (shouldListProjects) {
    await listProjects(organizationSlug);
    return;
  }

  if (shouldCreate) {
    await createProject(organizationSlug);
    return;
  }

  if (shouldRefreshDbUrl) {
    await refreshPoolerDbUrl();
    return;
  }

  if (shouldRefreshApiEnv) {
    await refreshApiEnv();
    return;
  }

  console.log('Nenhuma ação executada. Use --list-orgs, --list-projects ou --create.');
}

main().catch((err) => {
  console.error(err?.message || err);
  process.exit(1);
});

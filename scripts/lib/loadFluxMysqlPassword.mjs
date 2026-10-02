import { execSync } from 'node:child_process';

/**
 * Garante FLUX_MYSQL_PASSWORD em process.env (string plana).
 * Nunca serializa o objeto Error completo — evita "Converting circular structure to JSON" (issuerCertificate).
 */
export function ensureFluxMysqlPassword(project = process.env.GCP_PROJECT_ID || 'rh-coopmob-bot') {
  const existing = process.env.FLUX_MYSQL_PASSWORD?.trim();
  if (existing) return existing;

  try {
    const pwd = execSync(
      `gcloud secrets versions access latest --secret=flux-mysql-password --project=${project}`,
      { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
    ).trim();
    if (pwd) process.env.FLUX_MYSQL_PASSWORD = pwd;
    return pwd || null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(JSON.stringify({ error: 'flux_mysql_password_fetch_failed', message }));
    return null;
  }
}

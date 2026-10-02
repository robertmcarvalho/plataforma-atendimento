#!/usr/bin/env node
/**
 * Smoke Stage: só client_credentials + mTLS (NÃO emite boleto).
 * Credenciais: .secrets/cora-flux-client-id.txt + .secrets/cora-flux-mtls/
 *
 * Uso: node apps/api-service/scripts/smoke-cora-token.mjs
 */
import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../..');
const secretsDir = path.join(repoRoot, '.secrets');
const clientIdPath = path.join(secretsDir, 'cora-flux-client-id.txt');
const certPath = path.join(secretsDir, 'cora-flux-mtls', 'certificate.pem');
const keyPath = path.join(secretsDir, 'cora-flux-mtls', 'private-key.key');
const stageTokenUrl = 'https://matls-clients.api.stage.cora.com.br/token';

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

if (!fs.existsSync(clientIdPath)) {
  fail(`Crie ${path.relative(repoRoot, clientIdPath)} com o client_id (uma linha). Não commitar.`);
}
if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
  fail('Par mTLS ausente em .secrets/cora-flux-mtls/ (certificate.pem + private-key.key).');
}

const clientId = fs.readFileSync(clientIdPath, 'utf8').replace(/^\uFEFF/, '').trim().split(/\r?\n/)[0];
if (!clientId || clientId.length < 8) fail('client_id vazio ou inválido no arquivo local.');

const cert = fs.readFileSync(certPath);
const key = fs.readFileSync(keyPath);
const body = new URLSearchParams({
  grant_type: 'client_credentials',
  client_id: clientId,
}).toString();

const url = new URL(stageTokenUrl);

const result = await new Promise((resolve) => {
  const req = https.request(
    {
      protocol: url.protocol,
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        Accept: 'application/json',
      },
      cert,
      key,
      rejectUnauthorized: true,
      timeout: 30_000,
    },
    (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed = null;
        try {
          parsed = text ? JSON.parse(text) : null;
        } catch {
          parsed = null;
        }
        resolve({
          status: res.statusCode || 0,
          has_access_token: Boolean(parsed?.access_token),
          expires_in: parsed?.expires_in ?? null,
          token_type: parsed?.token_type ?? null,
          // Nunca logar access_token nem client_id
          body_keys: parsed && typeof parsed === 'object' ? Object.keys(parsed) : [],
          error_hint:
            res.statusCode && res.statusCode >= 400
              ? String(text || '').slice(0, 200)
              : null,
        });
      });
    }
  );
  req.on('timeout', () => {
    req.destroy();
    resolve({ status: 0, has_access_token: false, error_hint: 'timeout' });
  });
  req.on('error', (err) => {
    resolve({ status: 0, has_access_token: false, error_hint: err.message });
  });
  req.write(body);
  req.end();
});

const ok = result.status >= 200 && result.status < 300 && result.has_access_token;
console.log(
  JSON.stringify(
    {
      ok,
      environment: 'stage',
      url: stageTokenUrl,
      http_status: result.status,
      has_access_token: result.has_access_token,
      expires_in: result.expires_in,
      token_type: result.token_type,
      mtls_cert_present: true,
      client_id_file: path.relative(repoRoot, clientIdPath),
      note: ok
        ? 'Token Stage OK — não emitiu boleto.'
        : 'Falha no token. Cert production pode não valer em Stage; confirme com Cora.',
      error_hint: result.error_hint,
    },
    null,
    2
  )
);
process.exit(ok ? 0 : 1);

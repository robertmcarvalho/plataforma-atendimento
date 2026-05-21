#!/usr/bin/env node
import { readFileSync, existsSync } from 'fs';
import pg from 'pg';

const dbUrl = readFileSync('.secrets/legacy-db-url.txt', 'utf8').trim();
const webhookBase = 'https://flux-farma-webhook-713561463013.us-central1.run.app';

const c = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await c.connect();

const users = await c.query(`
  SELECT u.email, u.name, u.platform_role, r.name AS workspace_role, u.is_active
  FROM public.users u
  LEFT JOIN public.roles r ON r.id = u.role_id
  ORDER BY u.email
`);

const channels = await c.query(`
  SELECT id, channel_type, provider, status, is_default, external_id, slug, config
  FROM public.workspace_channels
  ORDER BY channel_type, is_default DESC
`);

console.log('# Staging — plataforma-atendimento-staging (ojzzxqqatqncchnspkch)\n');
console.log('## Usuários\n');
for (const u of users.rows) {
  console.log(`- **${u.email}** — ${u.name} | papel: ${u.platform_role || u.workspace_role || 'member'} | ativo: ${u.is_active}`);
}

console.log('\n## Canais / Webhook\n');
for (const ch of channels.rows) {
  const cfg = ch.config || {};
  console.log(`### ${ch.channel_type} / ${ch.provider}`);
  console.log(`- ID canal: \`${ch.id}\``);
  console.log(`- Status: ${ch.status} | default: ${ch.is_default}`);
  console.log(`- external_id: ${ch.external_id || '—'}`);
  if (cfg.waba_id) console.log(`- WABA ID: ${cfg.waba_id}`);
  if (cfg.phone_number_id) console.log(`- phone_number_id (config): ${cfg.phone_number_id}`);
  if (ch.channel_type === 'whatsapp') {
    const cb = `${webhookBase}/webhook?channel_id=${ch.id}`;
    console.log(`- Callback Meta (produção Cloud Run): ${cb}`);
    console.log(`- Callback genérico: ${webhookBase}/webhook`);
  }
  if (ch.channel_type === 'email') {
    console.log(`- SMTP: configurado no \`config\` do canal (credenciais não listadas aqui)`);
  }
}

await c.end();

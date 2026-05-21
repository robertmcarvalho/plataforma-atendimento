import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();

const targets = [
  {
    file: 'apps/web/.env.local',
    required: [
      'NEXT_PUBLIC_API_URL',
      'NEXT_PUBLIC_SUPABASE_URL',
      'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    ],
  },
  {
    file: 'apps/api-service/.env',
    required: [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'JWT_SECRET',
      'GOOGLE_CLOUD_PROJECT_ID',
      'PUBSUB_TOPIC_CAMPAIGN',
      'META_PHONE_NUMBER_ID',
      'META_ACCESS_TOKEN',
    ],
  },
  {
    file: 'apps/webhook-service/.env',
    required: [
      'META_VERIFY_TOKEN',
      'META_APP_SECRET',
      'GOOGLE_CLOUD_PROJECT_ID',
      'PUBSUB_TOPIC_INBOUND',
      'PUBSUB_TOPIC_STATUS',
    ],
  },
  {
    file: 'apps/orchestrator-service/.env',
    required: [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GOOGLE_CLOUD_PROJECT_ID',
      'PUBSUB_SUBSCRIPTION_INBOUND',
      'PUBSUB_SUBSCRIPTION_STATUS',
      'PUBSUB_TOPIC_CAMPAIGN',
      'META_PHONE_NUMBER_ID',
      'META_ACCESS_TOKEN',
    ],
  },
  {
    file: 'apps/scheduler-service/.env',
    required: [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GOOGLE_CLOUD_PROJECT_ID',
      'PUBSUB_TOPIC_CAMPAIGN',
    ],
  },
  {
    file: 'apps/campaign-worker/.env',
    required: [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'GOOGLE_CLOUD_PROJECT_ID',
      'PUBSUB_SUBSCRIPTION_CAMPAIGN',
      'META_PHONE_NUMBER_ID',
      'META_ACCESS_TOKEN',
    ],
  },
];

function parseEnv(content) {
  const values = new Map();

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) {
      continue;
    }

    const separatorIndex = line.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();
    values.set(key, value);
  }

  return values;
}

let hasFailure = false;

for (const target of targets) {
  const absolutePath = path.join(root, target.file);

  if (!existsSync(absolutePath)) {
    hasFailure = true;
    console.log(`[FAIL] ${target.file} -> arquivo ausente`);
    continue;
  }

  const envMap = parseEnv(readFileSync(absolutePath, 'utf8'));
  const missing = target.required.filter((key) => {
    const value = envMap.get(key);
    return !value;
  });

  if (missing.length > 0) {
    hasFailure = true;
    console.log(`[FAIL] ${target.file} -> faltando ${missing.join(', ')}`);
    continue;
  }

  console.log(`[OK] ${target.file}`);
}

if (hasFailure) {
  process.exit(1);
}

console.log('[DONE] check-local-env concluido');

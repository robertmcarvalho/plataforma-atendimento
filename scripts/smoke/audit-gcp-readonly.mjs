#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = new Map();
for (const arg of process.argv.slice(2)) {
  const [key, ...rest] = arg.replace(/^--/, '').split('=');
  args.set(key, rest.join('=') || 'true');
}

const projectId = args.get('project') || process.env.GCP_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT;
const region = args.get('region') || process.env.GCP_REGION || process.env.CLOUD_RUN_REGION || 'us-central1';
const outDir = args.get('outDir') || 'reports';

if (!projectId) {
  console.error('Defina GCP_PROJECT_ID ou use --project=<id>. Este script e somente leitura.');
  process.exit(1);
}

function gcloudJson(commandArgs, fallback = []) {
  try {
    const output = execFileSync('gcloud', [...commandArgs, '--project', projectId, '--format=json'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return output.trim() ? JSON.parse(output) : fallback;
  } catch (error) {
    return {
      error: String(error?.message || error),
      command: ['gcloud', ...commandArgs, '--project', projectId, '--format=json'].join(' '),
    };
  }
}

function redactEnvVars(env = []) {
  return env.map((item) => ({
    name: item.name,
    value: item.value ? '[REDACTED]' : undefined,
    valueFrom: item.valueFrom ? '[SECRET_OR_REFERENCE]' : undefined,
  }));
}

function summarizeRunService(service) {
  const template = service?.spec?.template || {};
  const containers = template?.spec?.containers || [];
  return {
    name: service?.metadata?.name,
    location: service?.metadata?.labels?.['cloud.googleapis.com/location'] || region,
    url: service?.status?.url,
    created_at: service?.metadata?.creationTimestamp,
    updated_at: service?.status?.latestCreatedRevisionName,
    traffic: service?.status?.traffic || [],
    service_account: template?.spec?.serviceAccountName || null,
    concurrency: template?.spec?.containerConcurrency || null,
    timeout_seconds: template?.spec?.timeoutSeconds || null,
    containers: containers.map((container) => ({
      image: container.image,
      env: redactEnvVars(container.env || []),
      ports: container.ports || [],
      resources: container.resources || {},
    })),
  };
}

const cloudRunServices = gcloudJson(['run', 'services', 'list', '--region', region]);
const cloudRunDetails = Array.isArray(cloudRunServices)
  ? cloudRunServices.map((service) =>
      summarizeRunService(gcloudJson(['run', 'services', 'describe', service.metadata.name, '--region', region], {}))
    )
  : cloudRunServices;

const inventory = {
  generated_at: new Date().toISOString(),
  mode: 'readonly',
  project_id: projectId,
  region,
  cloud_run: {
    services: cloudRunDetails,
  },
  pubsub: {
    topics: gcloudJson(['pubsub', 'topics', 'list']),
    subscriptions: gcloudJson(['pubsub', 'subscriptions', 'list']),
  },
  secrets: {
    metadata_only: true,
    items: gcloudJson(['secrets', 'list']),
  },
  cloud_build: {
    triggers: gcloudJson(['builds', 'triggers', 'list']),
  },
  scheduler: {
    jobs: gcloudJson(['scheduler', 'jobs', 'list', '--location', region]),
  },
};

mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `gcp-readonly-inventory-${projectId}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
writeFileSync(outFile, `${JSON.stringify(inventory, null, 2)}\n`);

console.log(`Inventario read-only gerado em ${outFile}`);

import 'dotenv/config';
import { PubSub } from '@google-cloud/pubsub';
import { createClient } from '@supabase/supabase-js';
import { createLogger } from '@plataforma/logger';
import { startSchedulerServer } from './http/server';
import { createSchedulerJobs } from './schedulerJobs';

const pubsub = new PubSub({ projectId: process.env.GOOGLE_CLOUD_PROJECT_ID });
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const logger = createLogger('scheduler-service');
const console = logger.console;

const jobs = createSchedulerJobs(supabase, pubsub);
const useCloudScheduler = process.env.SCHEDULER_USE_CLOUD_SCHEDULER === 'true';

console.log('Scheduler Service iniciando...');
startSchedulerServer(jobs);

if (useCloudScheduler) {
  console.log('Modo Cloud Scheduler ativo — node-cron desabilitado.');
  console.log(`Jobs HTTP disponíveis: ${jobs.catalog.map((j) => j.name).join(', ')}`);
} else {
  jobs.registerCrons();
  console.log('Modo node-cron (dev/fallback) — crons internos ativos.');
  for (const entry of jobs.catalog) {
    console.log(`  - ${entry.schedule || '?'}: ${entry.name} — ${entry.description}`);
  }
}

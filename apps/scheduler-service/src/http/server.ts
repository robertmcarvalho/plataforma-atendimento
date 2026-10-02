import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import type { SchedulerJobs } from '../schedulerJobs';

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function authorizeJobRequest(request: IncomingMessage): boolean {
  const expected = process.env.SCHEDULER_JOB_TOKEN?.trim();
  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      console.warn('[HTTP] SCHEDULER_JOB_TOKEN ausente em producao — jobs abertos');
    }
    return true;
  }
  const header = request.headers['x-scheduler-token'];
  return typeof header === 'string' && header === expected;
}

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

export function startSchedulerServer(jobs: SchedulerJobs) {
  const port = Number(process.env.PORT) || 8080;
  const useCloudScheduler = process.env.SCHEDULER_USE_CLOUD_SCHEDULER === 'true';

  const server = createServer(async (request, response) => {
    const url = request.url || '/';
    const method = request.method || 'GET';

    if (method === 'GET' && url === '/health') {
      sendJson(response, 200, {
        status: 'ok',
        service: 'scheduler-service',
        timezone: jobs.timezone,
        cloud_scheduler_mode: useCloudScheduler,
        campaign_topic: process.env.PUBSUB_TOPIC_CAMPAIGN || null,
        ts: new Date().toISOString(),
      });
      return;
    }

    if (method === 'GET' && url === '/jobs') {
      sendJson(response, 200, {
        mode: useCloudScheduler ? 'cloud_scheduler' : 'node_cron',
        jobs: jobs.catalog,
      });
      return;
    }

    if (method === 'POST' && url.startsWith('/jobs/')) {
      if (!authorizeJobRequest(request)) {
        sendJson(response, 401, { ok: false, error: 'unauthorized' });
        return;
      }

      const jobName = decodeURIComponent(url.slice('/jobs/'.length).split('?')[0] || '');
      if (!jobName) {
        sendJson(response, 400, { ok: false, error: 'job name required' });
        return;
      }

      await readBody(request).catch(() => '');
      const started = Date.now();
      const result = await jobs.runJob(jobName);
      sendJson(response, result.ok ? 200 : 500, {
        ...result,
        job: jobName,
        duration_ms: Date.now() - started,
      });
      return;
    }

    sendJson(response, 404, { error: 'Not Found' });
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Scheduler HTTP server na porta ${port} (cloud_scheduler=${useCloudScheduler})`);
  });

  return server;
}

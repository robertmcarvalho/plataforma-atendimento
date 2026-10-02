import { GoogleAuth } from 'google-auth-library';

type NightScaleMode = 'off' | 'on';

function nightModeEnabled(): boolean {
  return process.env.ORCHESTRATOR_NIGHT_MODE_ENABLED !== 'false';
}

function projectId(): string {
  return (
    process.env.GOOGLE_CLOUD_PROJECT_ID ||
    process.env.GCP_PROJECT_ID ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ''
  ).trim();
}

function region(): string {
  return (process.env.GCP_REGION || 'us-central1').trim();
}

function orchestratorService(): string {
  return (process.env.ORCHESTRATOR_RUN_SERVICE || 'flux-farma-orchestrator').trim();
}

async function patchOrchestratorScaling(mode: NightScaleMode): Promise<void> {
  const project = projectId();
  if (!project) throw new Error('GOOGLE_CLOUD_PROJECT_ID ausente para night mode');

  const minInstanceCount = mode === 'off' ? 0 : 1;
  const cpuThrottling = mode === 'off';

  const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  const client = await auth.getClient();
  const service = orchestratorService();
  const loc = region();
  const url = `https://run.googleapis.com/v2/projects/${project}/locations/${loc}/services/${service}?updateMask=template.scaling.minInstanceCount,template.annotations`;

  const body = {
    template: {
      scaling: { minInstanceCount },
      annotations: {
        'run.googleapis.com/cpu-throttling': cpuThrottling ? 'true' : 'false',
        ...(minInstanceCount > 0 ? { 'autoscaling.knative.dev/minScale': String(minInstanceCount) } : {}),
      },
    },
  };

  await client.request({ url, method: 'PATCH', data: body });
}

async function warmupOrchestratorHealth(): Promise<void> {
  const baseUrl = (process.env.ORCHESTRATOR_HEALTH_URL || '').trim();
  if (!baseUrl) {
    console.warn('[NightMode] ORCHESTRATOR_HEALTH_URL ausente; warmup ignorado');
    return;
  }
  const url = baseUrl.endsWith('/health') ? baseUrl : `${baseUrl.replace(/\/$/, '')}/health`;
  const auth = new GoogleAuth();
  const client = await auth.getIdTokenClient(url.replace(/\/health$/, ''));
  const res = await client.request({ url, method: 'GET' });
  const status = (res as { status?: number }).status;
  if (status && status >= 400) {
    throw new Error(`warmup /health status ${status}`);
  }
}

export function registerOrchestratorNightModeJobs(timezone: string) {
  return {
    timezone,
    async scaleOff(): Promise<void> {
      if (!nightModeEnabled()) return;
      console.log('[NightMode] orchestrator scale off (min=0)');
      await patchOrchestratorScaling('off');
      console.log('[NightMode] orchestrator min=0 aplicado');
    },
    async warmup(): Promise<void> {
      if (!nightModeEnabled()) return;
      console.log('[NightMode] warmup orchestrator /health');
      await warmupOrchestratorHealth();
      console.log('[NightMode] warmup OK');
    },
    async scaleOn(): Promise<void> {
      if (!nightModeEnabled()) return;
      console.log('[NightMode] orchestrator scale on (min=1, CPU 24h)');
      await patchOrchestratorScaling('on');
      console.log('[NightMode] orchestrator min=1 aplicado');
    },
  };
}

import type { FastifyInstance } from 'fastify';
import { registerCommercialDashboardRoutes } from './dashboard';
import { registerCommercialLeadRoutes } from './leads';
import { registerCommercialNotificationRoutes } from './notifications';
import { registerCommercialPipelineRoutes } from './pipeline';
import { registerCommercialProposalRoutes } from './proposals';

export async function commercialRoutes(app: FastifyInstance) {
  if (process.env.NODE_ENV !== 'production') {
    app.get('/dev/routes', async () => ({
      ok: true,
      dimensioning_select: true,
      dimensioning_commercial: true,
      dimensioning_confirm: true,
      ts: new Date().toISOString(),
    }));
  }

  await registerCommercialPipelineRoutes(app);
  await registerCommercialLeadRoutes(app);
  await registerCommercialNotificationRoutes(app);
  await registerCommercialProposalRoutes(app);
  await registerCommercialDashboardRoutes(app);
}

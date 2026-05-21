import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import jwt from '@fastify/jwt';
import multipart from '@fastify/multipart';

import { authRoutes } from './routes/auth';
import { userRoutes } from './routes/users';
import { sectorRoutes } from './routes/sectors';
import { pharmacyRoutes } from './routes/pharmacies';
import { leaderRoutes } from './routes/leaders';
import { driverRoutes } from './routes/drivers';
import { contactRoutes } from './routes/contacts';
import { conversationRoutes } from './routes/conversations';
import { conversationTagRoutes } from './routes/conversationTags';
import { messageRoutes } from './routes/messages';
import { templateRoutes } from './routes/templates';
import { botRoutes } from './routes/bot';
import { campaignRoutes } from './routes/campaigns';
import { automationRoutes } from './routes/automations';
import { financialRoutes } from './routes/financial';
import { reportRoutes } from './routes/reports';
import { slaRoutes } from './routes/sla';
import { settingRoutes } from './routes/settings';
import { roleRoutes } from './routes/roles';
import { workspaceRoutes } from './routes/workspace';
import { workspaceCatalogRoutes } from './routes/workspaceCatalogs';
import { conversationFlowRoutes } from './routes/conversationFlows';
import { platformRoutes } from './routes/platform';
import { integrationsRoutes } from './routes/integrations';
import { apiTokenRoutes } from './routes/apiTokens';
import { auditLogRoutes } from './routes/auditLogs';
import { copilotRoutes } from './routes/copilot';
import { dashboardRoutes } from './routes/dashboard';
import { presenceRoutes } from './routes/presence';
import { geoRoutes } from './routes/geo';
import { leaderPortalRoutes } from './routes/leader-portal';
import { taskRoutes } from './routes/tasks';
import { ticketRoutes } from './routes/tickets';
import { mcpToolRoutes } from './routes/mcp-tools';
import { mcpMetricsRoutes } from './routes/mcp-metrics';
import { aiRoutes } from './routes/ai';
import { devBootstrapRoutes } from './routes/dev-bootstrap';
import { rollupWorkspaceChannelStats } from './lib/channelRollup';
import { createLogger, normalizeError } from '@plataforma/logger';
import { registerRequestContext } from './middleware/requestContext';

const logger = createLogger('api-service');
const app = Fastify({ logger: false });

function resolveJwtSecret() {
  const secret = process.env.JWT_SECRET?.trim();
  if (!secret || secret === 'changeme' || secret.length < 32) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('JWT_SECRET must be set to a strong value in production.');
    }
    logger.warn('JWT_SECRET is weak or missing; using development-only fallback.', { event_type: 'security.jwt_secret_fallback' });
    return 'development-only-jwt-secret-change-me';
  }
  return secret;
}

// Plugins
app.register(cors, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
});

app.register(jwt, {
  secret: resolveJwtSecret(),
});

app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
registerRequestContext(app);

// Health check
app.get('/health', async () => ({ status: 'ok', service: 'api-service', ts: new Date().toISOString() }));

// Routes
app.register(authRoutes,          { prefix: '/api/auth' });
app.register(userRoutes,          { prefix: '/api/users' });
app.register(sectorRoutes,        { prefix: '/api/sectors' });
app.register(pharmacyRoutes,      { prefix: '/api/pharmacies' });
app.register(leaderRoutes,        { prefix: '/api/leaders' });
app.register(driverRoutes,        { prefix: '/api/drivers' });
app.register(contactRoutes,       { prefix: '/api/contacts' });
app.register(conversationRoutes,  { prefix: '/api/conversations' });
app.register(conversationTagRoutes, { prefix: '/api/conversation-tags' });
app.register(messageRoutes,       { prefix: '/api/messages' });
app.register(templateRoutes,      { prefix: '/api/templates' });
app.register(botRoutes,           { prefix: '/api/bot' });
app.register(campaignRoutes,      { prefix: '/api/campaigns' });
app.register(automationRoutes,    { prefix: '/api/automations' });
app.register(financialRoutes,     { prefix: '/api/financial' });
app.register(reportRoutes,        { prefix: '/api/reports' });
app.register(dashboardRoutes,     { prefix: '/api/dashboard' });
app.register(presenceRoutes,      { prefix: '/api/presence' });
app.register(geoRoutes,           { prefix: '/api/geo' });
app.register(slaRoutes,           { prefix: '/api/sla' });
app.register(leaderPortalRoutes,    { prefix: '/api/leader-portal' });
app.register(taskRoutes,           { prefix: '/api/tasks' });
app.register(ticketRoutes,         { prefix: '/api/tickets' });
app.register(mcpToolRoutes,        { prefix: '/api/mcp' });
app.register(mcpMetricsRoutes,     { prefix: '/api/mcp-metrics' });
app.register(settingRoutes,       { prefix: '/api/settings' });
app.register(roleRoutes,          { prefix: '/api/roles' });
app.register(workspaceRoutes,    { prefix: '/api/workspace' });
app.register(workspaceCatalogRoutes, { prefix: '/api/workspace-catalogs' });
app.register(conversationFlowRoutes, { prefix: '/api/conversation-flows' });
app.register(platformRoutes, { prefix: '/api/platform' });
app.register(integrationsRoutes, { prefix: '/api/integrations' });
app.register(apiTokenRoutes,     { prefix: '/api/api-tokens' });
app.register(auditLogRoutes,     { prefix: '/api/audit-logs' });
app.register(copilotRoutes,      { prefix: '/api/copilot' });
app.register(aiRoutes,          { prefix: '/api/ai' });

const enableDevRoutes = process.env.ENABLE_DEV_ROUTES === 'true';
if (enableDevRoutes) {
  app.register(devBootstrapRoutes, { prefix: '/api/dev' });
}

const start = async () => {
  try {
    const port = Number(process.env.PORT) || 3001;
    await app.listen({ port, host: '0.0.0.0' });
    logger.info('API Service rodando', { event_type: 'service.started', port });

    const rollupMs = Number(process.env.CHANNEL_ROLLUP_INTERVAL_MS || 0);
    if (rollupMs > 0) {
      const tick = async () => {
        try {
          const r = await rollupWorkspaceChannelStats();
          logger.info('channel rollup', { event_type: 'channel.rollup', updated: r.updated });
        } catch (e) {
          logger.warn('channel rollup failed', { event_type: 'channel.rollup_failed', ...normalizeError(e, 'WORKER_ERROR') });
        }
      };
      void tick();
      setInterval(tick, rollupMs);
    }
  } catch (err) {
    logger.error('api service failed to start', { event_type: 'service.start_failed', ...normalizeError(err, 'WORKER_ERROR') });
    process.exit(1);
  }
};

start();

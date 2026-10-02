import { createServer } from 'http';
import { orchestratorConsole as console } from './lib/orchestratorContext';

export function startHealthServer() {
  const port = Number(process.env.PORT) || 3003;
  const server = createServer((request, response) => {
    if (request.url === '/health') {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(
        JSON.stringify({
          status: 'ok',
          service: 'orchestrator-service',
          subscriptions: [
            process.env.PUBSUB_SUBSCRIPTION_INBOUND,
            process.env.PUBSUB_SUBSCRIPTION_INBOUND_AUTO,
            process.env.PUBSUB_SUBSCRIPTION_STATUS,
          ].filter(Boolean),
          ts: new Date().toISOString(),
        })
      );
      return;
    }

    response.writeHead(404, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ error: 'Not Found' }));
  });

  server.listen(port, '0.0.0.0', () => {
    console.log(`Orchestrator health server rodando na porta ${port}`);
  });
}

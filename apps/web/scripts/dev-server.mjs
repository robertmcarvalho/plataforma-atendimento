import http from 'node:http';
import next from 'next';

const port = Number(process.env.PORT) || 3000;
const hostname = process.env.HOSTNAME || '0.0.0.0';

// Run a custom dev server to avoid issues with detached/background processes on Windows.
// Important: wire both request handler and upgrade handler so HMR works.
const app = next({
  dev: true,
  dir: process.cwd(),
  hostname,
  port,
  webpack: true,
});

try {
  await app.prepare();

  const handle = app.getRequestHandler();
  const upgrade = app.getUpgradeHandler?.() || null;

  const server = http.createServer((req, res) => handle(req, res));
  if (upgrade) {
    server.on('upgrade', (req, socket, head) => {
      upgrade(req, socket, head).catch(() => socket.destroy());
    });
  }

  server.listen(port, hostname, () => {
    console.log(`▲ Next.js (dev)`);
    console.log(`- Local:   http://localhost:${port}`);
    console.log(`- Network: http://${hostname}:${port}`);
    console.log(`- Environments: .env.local`);
    console.log(`✓ Ready`);
  });
} catch (err) {
  console.error(err);
  process.exit(1);
}


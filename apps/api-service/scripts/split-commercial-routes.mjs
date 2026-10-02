import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src/routes/commercial.ts');
const outDir = path.join(root, 'src/routes/commercial');
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);

const slice = (a, b) => lines.slice(a - 1, b).join('\n');

const importBlock = slice(1, 92);
const preHandlers = slice(94, 100);

const shared = `import { authenticate } from '../../middleware/authenticate';
import {
  requireCommercialModule,
  requireCommercialProposals,
  requireCommercialRole,
} from '../../lib/commercial/commercialAuth';

${preHandlers}
`;

const helper = slice(1434, 1450);

const modules = [
  {
    file: 'pipeline.ts',
    fn: 'registerCommercialPipelineRoutes',
    body: slice(113, 285),
    extra: '',
  },
  {
    file: 'leads.ts',
    fn: 'registerCommercialLeadRoutes',
    body: `${slice(287, 884)}\n\n${slice(1139, 1357)}\n\n${helper}`,
    extra: '',
  },
  {
    file: 'proposals.ts',
    fn: 'registerCommercialProposalRoutes',
    body: slice(886, 1075),
    extra: '',
  },
  {
    file: 'dashboard.ts',
    fn: 'registerCommercialDashboardRoutes',
    body: `${slice(1077, 1137)}\n\n${slice(1359, 1431)}`,
    extra: '',
  },
];

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'shared.ts'), shared);

for (const mod of modules) {
  const content = `${importBlock}
import type { FastifyInstance } from 'fastify';
import { commercialPre, proposalPre } from './shared';

export async function ${mod.fn}(app: FastifyInstance) {
${mod.body}
}
`;
  fs.writeFileSync(path.join(outDir, mod.file), content);
  console.log('wrote', mod.file);
}

const index = `import type { FastifyInstance } from 'fastify';
import { registerCommercialDashboardRoutes } from './dashboard';
import { registerCommercialLeadRoutes } from './leads';
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
  await registerCommercialProposalRoutes(app);
  await registerCommercialDashboardRoutes(app);
}
`;

fs.writeFileSync(path.join(outDir, 'index.ts'), index);
console.log('wrote index.ts');

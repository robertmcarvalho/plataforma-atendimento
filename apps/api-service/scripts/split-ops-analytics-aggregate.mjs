import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'src/lib/opsAnalyticsAggregate.ts');
const outDir = path.join(root, 'src/lib/opsAnalytics');
const lines = fs.readFileSync(src, 'utf8').split(/\r?\n/);
const slice = (a, b) => lines.slice(a - 1, b).join('\n');

fs.mkdirSync(outDir, { recursive: true });

const sharedHeader = `import type { SupabaseClient } from '@supabase/supabase-js';
import { isSignaturePendingStatus } from '@plataforma/operational-notes';
import {
  getAttendantPortfolioPharmacyIds,
  getLeadersForAttendantPortfolio,
  intersectPortfolioWithLeader,
} from '../attendantPortfolio';
import { getLeaderManagedPharmacyIds } from '../leaderPortalScope';

`;

fs.writeFileSync(
  path.join(outDir, 'types.ts'),
  `${sharedHeader}
${slice(10, 66)}
`
);

fs.writeFileSync(
  path.join(outDir, 'portfolio.ts'),
  `${sharedHeader}
import type { PortfolioLeaderRow, PortfolioPharmacyRow, PortfolioSummary } from './types';

${slice(68, 498)}
`
);

fs.writeFileSync(
  path.join(outDir, 'coordination.ts'),
  `${sharedHeader}
import type { PortfolioPharmacyRow } from './types';
import { buildPortfolioSummaryForScope } from './portfolio';

${slice(500, 736)}
`
);

fs.writeFileSync(
  path.join(outDir, 'hub.ts'),
  `${sharedHeader}
import type { PortfolioAlert, PortfolioPharmacyRow, PortfolioSummary } from './types';
import { buildPortfolioSummaryForScope, getAllWorkspacePharmacyIds } from './portfolio';

${slice(738, 1203)}
`
);

fs.writeFileSync(
  path.join(outDir, 'executionBoard.ts'),
  `${sharedHeader}
import type { OpsHubTaskRow, PortfolioSummary } from './types';
import { mapTaskRows } from './hub';

${slice(1205, 1311)}
`
);

const barrel = `export * from './types';
export * from './portfolio';
export * from './coordination';
export * from './hub';
export * from './executionBoard';
`;

fs.writeFileSync(path.join(outDir, 'index.ts'), barrel);

const shim = `/** @deprecated Import from ./opsAnalytics — barrel mantido para imports legados. */
export * from './opsAnalytics';
`;

fs.writeFileSync(path.join(root, 'src/lib/opsAnalyticsAggregate.ts'), shim);
console.log('split opsAnalytics — verify build');

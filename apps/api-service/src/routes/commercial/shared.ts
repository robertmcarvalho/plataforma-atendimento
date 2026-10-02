import { authenticate } from '../../middleware/authenticate';
import {
  requireCommercialModule,
  requireCommercialProposals,
  requireCommercialRole,
} from '../../lib/commercial/commercialAuth';

export const commercialPre = [authenticate, requireCommercialModule(), requireCommercialRole()];
export const proposalPre = [
  authenticate,
  requireCommercialModule(),
  requireCommercialRole(),
  requireCommercialProposals(),
];

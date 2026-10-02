import type { FastifyInstance } from 'fastify';
import {
  registerBillingCostCenterRoutes,
  registerBillingExpenseTypeRoutes,
  registerBillingLegalEntityRoutes,
  registerBillingStatusRoutes,
} from './billing/index';
import { registerBillingCycleRoutes } from './billing/cycles';
import { registerBillingDeliveryRoutes } from './billing/deliveries';
import { registerBillingSettlementRoutes } from './billing/settlements';
import { registerBillingInvoiceRoutes } from './billing/invoices';
import { registerBillingPayableRoutes } from './billing/payables';
import { registerBillingReportRoutes } from './billing/reports';
import { registerBillingIntegrationRoutes } from './billing/integrations';
import { registerBillingCompanyPayrollRoutes } from './billing/companyPayroll';
import { registerBillingCommercialPartnerRoutes } from './billing/commercialPartners';
import { registerBillingLeaderCommissionRoutes } from './billing/leaderCommissions';
import { registerBillingTreasuryRoutes } from './billing/treasury';
import { registerBillingDreRoutes } from './billing/dre';
import { registerBillingOffboardingRoutes } from './billing/offboarding';
import { registerBillingLedgerRoutes } from './billing/ledgers';
import { registerBillingCapitalCooperativoRoutes } from './billing/capitalCooperativo';
import { registerBillingNfseRoutes } from './billing/nfse';
import { registerBillingCoraRoutes } from './billing/cora';
import { registerBillingPayslipRoutes } from './billing/payslips';

export async function billingRoutes(app: FastifyInstance) {
  await registerBillingStatusRoutes(app);
  await registerBillingCostCenterRoutes(app);
  await registerBillingExpenseTypeRoutes(app);
  await registerBillingLegalEntityRoutes(app);
  await registerBillingNfseRoutes(app);
  await registerBillingCoraRoutes(app);
  await registerBillingCycleRoutes(app);
  await registerBillingDeliveryRoutes(app);
  await registerBillingSettlementRoutes(app);
  await registerBillingInvoiceRoutes(app);
  await registerBillingPayableRoutes(app);
  await registerBillingPayslipRoutes(app);
  await registerBillingReportRoutes(app);
  await registerBillingIntegrationRoutes(app);
  await registerBillingCompanyPayrollRoutes(app);
  await registerBillingCommercialPartnerRoutes(app);
  await registerBillingLeaderCommissionRoutes(app);
  await registerBillingTreasuryRoutes(app);
  await registerBillingDreRoutes(app);
  await registerBillingOffboardingRoutes(app);
  await registerBillingLedgerRoutes(app);
  await registerBillingCapitalCooperativoRoutes(app);
}

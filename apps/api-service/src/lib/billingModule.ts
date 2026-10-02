/** Feature flag do módulo /billing — default habilitado fora de produção. */
export function isBillingModuleEnabled(): boolean {
  const raw = process.env.BILLING_MODULE_ENABLED?.trim().toLowerCase();
  if (raw === 'true' || raw === '1' || raw === 'yes') return true;
  if (raw === 'false' || raw === '0' || raw === 'no') return false;
  return process.env.NODE_ENV !== 'production';
}

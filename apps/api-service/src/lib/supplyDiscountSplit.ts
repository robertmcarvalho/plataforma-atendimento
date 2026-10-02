/** Percentual do valor de uniforme/bag descontado do cooperado (resto = custo Coop). */
export const SUPPLY_DRIVER_SHARE_PCT = 50;

export function splitSupplyDiscountAmount(totalAmount: number, driverSharePct = SUPPLY_DRIVER_SHARE_PCT): {
  grossAmount: number;
  driverAmount: number;
  coopAmount: number;
} {
  const gross = Math.round((Number(totalAmount) + Number.EPSILON) * 100) / 100;
  const driverAmount = Math.round((gross * driverSharePct) / 100 * 100) / 100;
  return {
    grossAmount: gross,
    driverAmount,
    coopAmount: Math.round((gross - driverAmount) * 100) / 100,
  };
}

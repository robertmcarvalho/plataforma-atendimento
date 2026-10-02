/** Farmácias padrão ao selecionar entregador no portal do líder (diárias/faltas). */
export function defaultPharmacyIdsForDriver(driver: {
  leader_linked_pharmacy_ids?: string[] | null;
  primary_pharmacy_id?: string | null;
} | null): string[] {
  if (!driver) return [];
  const preferred = (driver.leader_linked_pharmacy_ids || []).filter(Boolean);
  if (preferred.length) return preferred;
  if (driver.primary_pharmacy_id) return [driver.primary_pharmacy_id];
  return [];
}

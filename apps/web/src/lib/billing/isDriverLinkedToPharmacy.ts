export type DriverPharmacyLinkLike = {
  primary_pharmacy_id?: string | null;
  driver_pharmacy_links?: Array<{
    is_active?: boolean | null;
    pharmacy_id?: string | null;
    pharmacies?: { id: string } | null;
  }> | null;
};

/** True if primary pharmacy or an active driver_pharmacy_links row matches. */
export function isDriverLinkedToPharmacy(
  driver: DriverPharmacyLinkLike | null | undefined,
  pharmacyId: string
): boolean {
  if (!driver || !pharmacyId) return false;
  if (driver.primary_pharmacy_id === pharmacyId) return true;
  return (driver.driver_pharmacy_links || []).some((link) => {
    if (link.is_active === false) return false;
    if (link.pharmacy_id === pharmacyId) return true;
    return link.pharmacies?.id === pharmacyId;
  });
}

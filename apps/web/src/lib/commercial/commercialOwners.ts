import type { CommercialOwner } from '@/lib/commercial/commercialApi';

export function ownerName(ownerId: string, owners: CommercialOwner[]): string {
  return owners.find((o) => o.id === ownerId)?.name ?? '—';
}

export function ownerInitials(ownerId: string, owners: CommercialOwner[]): string {
  const name = ownerName(ownerId, owners);
  return (
    name
      .split(' ')
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join('') || '?'
  );
}

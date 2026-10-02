import { cleanBillingLabel, isSeedBillingLabel } from '@/lib/billing/billingDisplay';
import { BillingSeedTag } from '@/components/billing/BillingSeedTag';

/** Nome de entidade com tag ATIVMOB opcional (só UI). */
export function BillingEntityName({ name, className }: { name: string; className?: string }) {
  const label = cleanBillingLabel(name);
  if (!isSeedBillingLabel(name)) {
    return <span className={className}>{label}</span>;
  }
  return (
    <span className={`inline-flex items-center gap-1.5 ${className || ''}`}>
      <BillingSeedTag />
      <span>{label}</span>
    </span>
  );
}

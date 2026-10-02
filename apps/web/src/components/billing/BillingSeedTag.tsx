import { cn } from '@/lib/utils';
import { billingTagClassName } from '@/lib/billing/billingReviveUi';

/** Tag de identificação para registros de seed/demo (ex.: ATIVMOB). */
export function BillingSeedTag({ label = 'ATIVMOB', className }: { label?: string; className?: string }) {
  return (
    <span
      className={cn(
        billingTagClassName,
        'bg-channel-instagram/15 text-channel-instagram ring-channel-instagram/20',
        className
      )}
    >
      {label}
    </span>
  );
}

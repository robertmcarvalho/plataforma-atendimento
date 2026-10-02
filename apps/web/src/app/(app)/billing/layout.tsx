import { BillingLayoutGate } from '@/components/billing/BillingLayoutGate';
import { BillingModuleChrome } from '@/components/billing/BillingModuleChrome';

export default function BillingLayout({ children }: { children: React.ReactNode }) {
  return (
    <BillingLayoutGate>
      <BillingModuleChrome>{children}</BillingModuleChrome>
    </BillingLayoutGate>
  );
}

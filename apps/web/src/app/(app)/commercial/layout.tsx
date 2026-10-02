import { CommercialLayoutGate } from '@/components/commercial/CommercialLayoutGate';

export default function CommercialLayout({ children }: { children: React.ReactNode }) {
  return <CommercialLayoutGate>{children}</CommercialLayoutGate>;
}

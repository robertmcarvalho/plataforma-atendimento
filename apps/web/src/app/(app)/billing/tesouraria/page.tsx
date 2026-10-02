import { redirect } from 'next/navigation';

export default function BillingTesourariaRedirectPage() {
  redirect('/billing/config?tab=contas-bancarias');
}

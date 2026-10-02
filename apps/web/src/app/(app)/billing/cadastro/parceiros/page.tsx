import { redirect } from 'next/navigation';

export default function BillingCadastroParceirosRedirect() {
  redirect('/billing/cadastros?tab=parceiros');
}

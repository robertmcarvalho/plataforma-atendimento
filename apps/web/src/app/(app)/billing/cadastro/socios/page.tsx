import { redirect } from 'next/navigation';

export default function BillingCadastroSociosRedirect() {
  redirect('/billing/cadastros?tab=socios');
}

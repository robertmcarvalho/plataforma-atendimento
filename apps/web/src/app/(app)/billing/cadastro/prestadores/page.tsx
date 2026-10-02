import { redirect } from 'next/navigation';

export default function BillingCadastroPrestadoresRedirect() {
  redirect('/billing/cadastros?tab=prestadores');
}

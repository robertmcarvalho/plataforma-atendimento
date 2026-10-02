import { redirect } from 'next/navigation';

export default function BillingCadastroComissaoLideresRedirect() {
  redirect('/billing/config?tab=comissao-lideres');
}

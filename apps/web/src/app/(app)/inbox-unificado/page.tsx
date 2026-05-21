import { redirect } from 'next/navigation';

/** @deprecated Use `/inbox` — motor de ticket/MCP foi incorporado ao painel Detalhes da Caixa de entrada. */
export default function InboxUnificadoRedirectPage() {
  redirect('/inbox');
}

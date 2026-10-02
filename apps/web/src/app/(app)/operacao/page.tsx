'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { OperacaoCarteiraPage } from '@/components/operacao/OperacaoCarteiraPage';
import { OperacaoGestorOperacionalPage } from '@/components/operacao/OperacaoGestorOperacionalPage';
import { OperacaoExecucaoPage } from '@/components/operacao/OperacaoExecucaoPage';
import { OperacaoFinanceiroGestorPage } from '@/components/operacao/OperacaoFinanceiroGestorPage';
import { OperacaoModeTabs } from '@/components/operacao/OperacaoModeTabs';
import { useOperacaoMode } from '@/hooks/useOperacaoMode';
import { parseOperacaoPainelOverride, type OperacaoMode } from '@/lib/operacao/operacaoMode';

function OperacaoPageInner() {
  const searchParams = useSearchParams();
  const { mode: resolvedMode, modes, isLoading } = useOperacaoMode();

  const painelOverride = parseOperacaoPainelOverride(searchParams.get('painel'));
  const overrideAllowed =
    painelOverride && modes.includes(painelOverride) ? painelOverride : null;
  const mode: OperacaoMode = overrideAllowed || resolvedMode;

  if (isLoading) {
    return (
      <div className="mx-auto max-w-lg px-8 py-10 text-center text-sm text-muted-foreground">
        Carregando painel de operação…
      </div>
    );
  }

  const content = (() => {
    if (mode === 'carteira') return <OperacaoCarteiraPage />;
    if (mode === 'execucao_geral') return <OperacaoExecucaoPage mode="execucao_geral" />;
    if (mode === 'execucao_financeiro') return <OperacaoExecucaoPage mode="execucao_financeiro" />;
    if (mode === 'gestor_financeiro') return <OperacaoFinanceiroGestorPage />;
    if (mode === 'gestor_operacional') return <OperacaoGestorOperacionalPage />;
    return (
      <div className="mx-auto max-w-lg px-8 py-10 text-center text-sm text-muted-foreground">
        Esta área não está disponível para o seu perfil.
      </div>
    );
  })();

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      {modes.length > 1 ? (
        <div className="mx-auto w-full max-w-7xl shrink-0 px-4 pt-4 sm:px-8">
          <OperacaoModeTabs mode={mode} defaultMode={resolvedMode} modes={modes} />
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{content}</div>
    </div>
  );
}

export default function OperacaoPage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-lg px-8 py-10 text-center text-sm text-muted-foreground">
          Carregando…
        </div>
      }
    >
      <OperacaoPageInner />
    </Suspense>
  );
}

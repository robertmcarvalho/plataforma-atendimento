'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import {
  OPERACAO_PAINEL_OPTIONS,
  operacaoModeLabel,
  type OperacaoMode,
} from '@/lib/operacao/operacaoMode';
import { operacaoModeToRevivePerfil, revivePerfilMeta } from '@/lib/operacao/reviveCopy/reviveProfileMeta';
import { cn } from '@/lib/utils';

export function OperacaoPainelSwitcher({
  mode,
  defaultMode,
  availableModes,
}: {
  mode: OperacaoMode;
  defaultMode: OperacaoMode;
  availableModes?: OperacaoMode[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const isPreview = mode !== defaultMode;
  const options = availableModes?.length
    ? OPERACAO_PAINEL_OPTIONS.filter((o) => availableModes.includes(o.id))
    : OPERACAO_PAINEL_OPTIONS;

  if (options.length <= 1) return null;

  return (
    <div className="mb-4 rounded-xl border border-dashed border-border bg-surface/40 p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-wider text-subtle-foreground">
        <ShieldAlert className="h-3 w-3" strokeWidth={1.75} />
        <span>Perfil</span>
        {isPreview ? (
          <span className="normal-case tracking-normal text-muted-foreground">
            · Visualizando {operacaoModeLabel(mode)} (seu perfil: {operacaoModeLabel(defaultMode)})
          </span>
        ) : (
          <span className="normal-case tracking-normal text-muted-foreground">
            · Seu perfil abre {operacaoModeLabel(defaultMode)}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {options.map((o) => {
          const perfil = operacaoModeToRevivePerfil(o.id);
          const Icon = perfil ? revivePerfilMeta[perfil].icon : ShieldAlert;
          const active = mode === o.id;
          return (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                if (o.id === defaultMode) {
                  params.delete('painel');
                } else {
                  params.set('painel', o.id);
                }
                const qs = params.toString();
                router.push(qs ? `/operacao?${qs}` : '/operacao');
              }}
              className={cn(
                'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] transition-colors',
                active ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-surface text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3 w-3" strokeWidth={1.75} />
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

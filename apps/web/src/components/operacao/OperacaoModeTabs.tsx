'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { operacaoModeLabel, type OperacaoMode } from '@/lib/operacao/operacaoMode';
import { cn } from '@/lib/utils';

export function OperacaoModeTabs({
  mode,
  defaultMode,
  modes,
}: {
  mode: OperacaoMode;
  defaultMode: OperacaoMode;
  modes: OperacaoMode[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();

  if (modes.length <= 1) return null;

  return (
    <div className="mb-4 border-b border-border">
      <div className="flex flex-wrap gap-1">
        {modes.map((m) => {
          const active = mode === m;
          return (
            <button
              key={m}
              type="button"
              onClick={() => {
                const params = new URLSearchParams(searchParams.toString());
                if (m === defaultMode) params.delete('painel');
                else params.set('painel', m);
                const qs = params.toString();
                router.push(qs ? `/operacao?${qs}` : '/operacao');
              }}
              className={cn(
                'border-b-2 px-3 py-2 text-xs font-medium transition-colors',
                active
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'
              )}
            >
              {operacaoModeLabel(m)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

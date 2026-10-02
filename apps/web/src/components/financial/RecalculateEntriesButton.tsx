'use client';

import { useState } from 'react';
import api from '@/lib/api';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { cn } from '@/lib/utils';
import { reviveOutlineButtonClassName } from '@/lib/reviveSurfaces';

export function RecalculateEntriesButton({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false);
  const run = async (dryRun: boolean) => {
    if (!dryRun && !window.confirm('Recalcular todos os lançamentos com as regras atuais? Isso atualiza datas, descrições e parcelas.')) {
      return;
    }
    setBusy(true);
    try {
      const res = await api.post('/api/financial/entries/recalculate', { dry_run: dryRun });
      const data = res.data as { processed: number; updated: number; skipped: number; errors?: Array<{ id: string; error: string }> };
      const errCount = data.errors?.length ?? 0;
      window.alert(
        dryRun
          ? `Simulação: ${data.processed} processados, ${data.updated} seriam atualizados, ${data.skipped} ignorados, ${errCount} erros.`
          : `Concluído: ${data.updated} atualizados de ${data.processed}. ${errCount} erros.`
      );
      if (!dryRun) onClose();
    } catch (e: unknown) {
      window.alert(apiErrorMessage(e, 'Falha no recálculo. Verifique permissões.'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex gap-2 mr-auto">
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(true)}
        className={cn(reviveOutlineButtonClassName, 'disabled:opacity-50')}
      >
        Simular recálculo
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => void run(false)}
        className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs font-medium text-warning hover:bg-warning/20 disabled:opacity-50"
      >
        {busy ? 'Recalculando…' : 'Recalcular em massa'}
      </button>
    </div>
  );
}
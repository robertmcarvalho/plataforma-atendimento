'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import api from '@/lib/api';

function errMessage(e: unknown): string {
  if (e && typeof e === 'object' && 'response' in e) {
    const r = (e as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return String(r.data.error);
  }
  if (e instanceof Error) return e.message;
  return 'Falha ao gerar sugestão.';
}

export function SuggestReplyButton({
  conversationId,
  disabled,
  onInsert,
  className,
}: {
  conversationId: string | null;
  disabled?: boolean;
  onInsert: (text: string) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [suggestion, setSuggestion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (ev: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(ev.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const run = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    setError(null);
    setSuggestion('');
    try {
      const { data } = await api.post<{ suggestion: string; model?: string }>('/api/ai/suggest-reply', {
        conversation_id: conversationId,
      });
      setSuggestion((data?.suggestion || '').trim());
      setOpen(true);
    } catch (e) {
      setError(errMessage(e));
      setOpen(true);
    } finally {
      setLoading(false);
    }
  }, [conversationId]);

  return (
    <div className={cn('relative', className)} ref={panelRef}>
      <button
        type="button"
        onClick={() => void run()}
        disabled={disabled || !conversationId || loading}
        className="flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[10px] font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3 text-primary" />}
        Sugerir resposta
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(100vw-2rem,22rem)] rounded-xl border border-border bg-surface-elevated p-3 shadow-glow">
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : suggestion ? (
            <>
              <p className="text-xs font-medium text-foreground">Sugestão</p>
              <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">{suggestion}</p>
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="rounded-md border border-border px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground"
                >
                  Fechar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onInsert(suggestion);
                    setOpen(false);
                  }}
                  className="rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary-glow"
                >
                  Inserir
                </button>
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground">Sem texto.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
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
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-3 py-1.5',
          'text-xs font-medium text-primary transition-colors',
          'hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50'
        )}
      >
        {loading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Sparkles className="h-3.5 w-3.5" />
        )}
        Sugerir resposta
      </button>
      {open ? (
        <div className="absolute bottom-full left-0 z-50 mb-2 w-[min(100vw-2rem,22rem)] rounded-xl border border-border bg-popover p-3 shadow-md">
          {error ? (
            <p className="text-xs text-destructive">{error}</p>
          ) : suggestion ? (
            <>
              <p className="text-xs font-medium text-foreground">Sugestão</p>
              <p className="mt-1 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-muted-foreground">{suggestion}</p>
              <div className="mt-2 flex justify-end gap-2">
                <Button type="button" variant="outline" size="xs" onClick={() => setOpen(false)}>
                  Fechar
                </Button>
                <Button
                  type="button"
                  size="xs"
                  onClick={() => {
                    onInsert(suggestion);
                    setOpen(false);
                  }}
                >
                  Inserir
                </Button>
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

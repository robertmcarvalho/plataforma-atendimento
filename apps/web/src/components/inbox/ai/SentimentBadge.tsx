'use client';

import { cn } from '@/lib/utils';

const EMOJI: Record<string, string> = {
  positivo: '🙂',
  neutro: '😐',
  negativo: '🙁',
};

export type SentimentValue = 'positivo' | 'neutro' | 'negativo' | string;

export function SentimentBadge({ sentiment, className }: { sentiment?: string | null; className?: string }) {
  if (!sentiment) return null;
  const em = EMOJI[sentiment] || '💬';
  const label =
    sentiment === 'positivo' ? 'Sentimento positivo' : sentiment === 'negativo' ? 'Sentimento negativo' : 'Sentimento neutro';
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex h-5 w-5 items-center justify-center rounded-full bg-background/80 text-[13px] leading-none border border-border/80',
        className
      )}
    >
      {em}
    </span>
  );
}

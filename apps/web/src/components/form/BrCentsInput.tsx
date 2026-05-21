'use client';

import { useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { formatBRL, onlyDigits } from '@/lib/brFormat';

type Props = {
  value: number | null;
  onChange: (cents: number | null) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
};

function formatCentsDisplay(cents: number): string {
  return formatBRL(cents / 100);
}

function parseDigitsToCents(raw: string): number | null {
  const digits = onlyDigits(raw);
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n : null;
}

/** Campo monetário com estado em centavos (dígitos = centavos, estável ao digitar). */
export function BrCentsInput({ value, onChange, className, disabled, placeholder = 'R$ 0,00' }: Props) {
  const focusedRef = useRef(false);
  const [text, setText] = useState(() =>
    value != null && Number.isFinite(value) ? formatCentsDisplay(value) : '',
  );

  useEffect(() => {
    if (focusedRef.current) return;
    setText(value != null && Number.isFinite(value) ? formatCentsDisplay(value) : '');
  }, [value]);

  return (
    <input
      type="text"
      inputMode="numeric"
      disabled={disabled}
      placeholder={placeholder}
      value={text}
      onFocus={() => {
        focusedRef.current = true;
        if (value != null && Number.isFinite(value) && value > 0) {
          setText(String(value));
        }
      }}
      onBlur={() => {
        focusedRef.current = false;
        if (value == null || !Number.isFinite(value)) {
          setText('');
        } else {
          setText(formatCentsDisplay(value));
        }
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        onChange(parseDigitsToCents(raw));
      }}
      className={cn(
        'w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20 disabled:opacity-50',
        className,
      )}
    />
  );
}

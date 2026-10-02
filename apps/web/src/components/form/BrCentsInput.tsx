'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { formControlClassName, formControlSizes } from '@/components/form/FormControl';
import { formatBRL, onlyDigits } from '@/lib/brFormat';

type Props = {
  value: number | null;
  onChange: (cents: number | null) => void;
  className?: string;
  disabled?: boolean;
  placeholder?: string;
  inputSize?: keyof typeof formControlSizes;
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

function formatFromProp(value: number | null) {
  return value != null && Number.isFinite(value) ? formatCentsDisplay(value) : '';
}

/** Campo monetário com estado em centavos (dígitos = centavos, estável ao digitar). */
export function BrCentsInput({ value, onChange, className, disabled, placeholder = 'R$ 0,00', inputSize = 'md' }: Props) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const displayValue = focused ? draft : formatFromProp(value);

  return (
    <input
      type="text"
      inputMode="numeric"
      disabled={disabled}
      placeholder={placeholder}
      value={displayValue}
      onFocus={() => {
        setFocused(true);
        if (value != null && Number.isFinite(value) && value !== 0) {
          setDraft(String(value));
        } else {
          setDraft('');
        }
      }}
      onBlur={() => {
        setFocused(false);
        setDraft('');
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        onChange(parseDigitsToCents(raw));
      }}
      className={cn(formControlClassName, formControlSizes[inputSize], className)}
    />
  );
}

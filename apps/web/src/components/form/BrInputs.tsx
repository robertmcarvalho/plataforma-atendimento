'use client';

import { useEffect, useState, type InputHTMLAttributes } from 'react';
import {
  formatCep,
  formatCnpj,
  formatCpf,
  formatBrazilPhone,
  onlyDigits,
  normalizeBrazilPhone,
  formatBRLInputMask,
  parseBRLInputToNumber,
} from '@/lib/brFormat';
import { cn } from '@/lib/utils';

type FieldProps = Pick<
  InputHTMLAttributes<HTMLInputElement>,
  'id' | 'className' | 'disabled' | 'placeholder' | 'required' | 'name' | 'autoComplete' | 'aria-invalid' | 'style'
>;

export function BrCpfInput({
  value,
  onChange,
  className,
  ...rest
}: FieldProps & {
  value: string;
  onChange: (digits: string) => void;
}) {
  return (
    <input
      {...rest}
      type="tel"
      inputMode="numeric"
      autoComplete="off"
      value={formatCpf(value)}
      onChange={(e) => onChange(onlyDigits(e.target.value).slice(0, 11))}
      className={cn(
        'mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20',
        className
      )}
    />
  );
}

export function BrCepInput({
  value,
  onChange,
  className,
  ...rest
}: FieldProps & {
  value: string;
  onChange: (digits: string) => void;
}) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="postal-code"
      value={formatCep(value)}
      onChange={(e) => onChange(onlyDigits(e.target.value).slice(0, 8))}
      className={cn(
        'mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20',
        className
      )}
    />
  );
}

export function BrCnpjInput({
  value,
  onChange,
  className,
  ...rest
}: FieldProps & {
  value: string;
  onChange: (digits: string) => void;
}) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      value={formatCnpj(value)}
      onChange={(e) => onChange(onlyDigits(e.target.value).slice(0, 14))}
      className={cn(
        'mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20',
        className
      )}
    />
  );
}

export function BrPhoneInput({
  value,
  onChange,
  className,
  ...rest
}: FieldProps & {
  value: string;
  onChange: (stored: string) => void;
}) {
  return (
    <input
      {...rest}
      type="text"
      inputMode="tel"
      autoComplete="tel"
      value={value ? formatBrazilPhone(value) : ''}
      onChange={(e) => {
        const raw = e.target.value.trim();
        const digits = onlyDigits(raw);
        const d = raw.startsWith('+55') ? digits.slice(2) : digits;
        onChange(normalizeBrazilPhone(d) || d);
      }}
      className={cn(
        'mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20',
        className
      )}
    />
  );
}

export function BrCurrencyInput({
  value,
  onChange,
  className,
  ...rest
}: FieldProps & {
  value: number | null;
  onChange: (n: number | null) => void;
}) {
  const [text, setText] = useState(() => (value === null || value === undefined ? '' : formatBRLInputMask(value)));

  useEffect(() => {
    setText(value === null || value === undefined ? '' : formatBRLInputMask(value));
  }, [value]);

  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={text}
      onChange={(e) => {
        const raw = e.target.value;
        setText(raw);
        onChange(parseBRLInputToNumber(raw));
      }}
      onBlur={() => {
        if (value === null || value === undefined) setText('');
        else setText(formatBRLInputMask(value));
      }}
      className={cn(
        'mt-1 w-full rounded-md border border-border bg-background/40 px-3 py-2 text-sm outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/20',
        className
      )}
    />
  );
}

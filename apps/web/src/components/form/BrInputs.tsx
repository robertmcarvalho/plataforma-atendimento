'use client';

import { useState, type InputHTMLAttributes } from 'react';
import {
  formatCep,
  formatCnpj,
  formatCpf,
  formatBrazilPhone,
  onlyDigits,
  normalizeBrazilPhone,
  formatBRL,
} from '@/lib/brFormat';
import { cn } from '@/lib/utils';
import {
  formControlClassName,
  formControlDateClassName,
  formControlSizes,
  formControlTimeClassName,
} from '@/components/form/FormControl';
import {
  formatIsoDateBr,
  maskBrDateInput,
  maskBrTimeInput,
  normalizeTimeBr,
  parseBrDateToIso,
} from '@/lib/datetimeBr';

/** @deprecated Preferir FormControl — mantido para Br* inputs. */
export const brFieldClassName = cn(formControlClassName, formControlSizes.md);

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
        'mt-1',
        brFieldClassName,
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
        'mt-1',
        brFieldClassName,
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
        'mt-1',
        brFieldClassName,
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
        'mt-1',
        brFieldClassName,
        className
      )}
    />
  );
}

function parseDigitsToReais(raw: string): number | null {
  const digits = onlyDigits(raw);
  if (!digits) return null;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) ? n / 100 : null;
}

function formatReaisFromProp(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return formatBRL(value);
}

/** Campo monetário BRL; valor em reais (ex.: 1000 = R$ 1.000,00). Estável ao digitar (draft local). */
export function BrCurrencyInput({
  value,
  onChange,
  className,
  placeholder = 'R$ 0,00',
  onBlur,
  ...rest
}: FieldProps & {
  value: number | null;
  onChange: (n: number | null) => void;
  placeholder?: string;
  onBlur?: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const displayValue = focused ? draft : formatReaisFromProp(value);

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      placeholder={placeholder}
      value={displayValue}
      onFocus={() => {
        setFocused(true);
        if (value != null && Number.isFinite(value) && value !== 0) {
          setDraft(String(Math.round(value * 100)));
        } else {
          setDraft('');
        }
      }}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        onChange(parseDigitsToReais(raw));
      }}
      onBlur={() => {
        setFocused(false);
        setDraft('');
        onBlur?.();
      }}
      className={cn(brFieldClassName, className)}
    />
  );
}

type BrScheduleFieldProps = FieldProps & {
  value: string;
  onChange: (value: string) => void;
};

/** Data no padrão BR (dd/mm/aaaa); valor ISO yyyy-mm-dd para API. */
export function BrDateInput({ value, onChange, className, disabled, placeholder = 'dd/mm/aaaa', ...rest }: BrScheduleFieldProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const displayValue = focused ? draft : formatIsoDateBr(value);

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      value={displayValue}
      onFocus={() => {
        setFocused(true);
        setDraft(formatIsoDateBr(value));
      }}
      onChange={(e) => {
        const masked = maskBrDateInput(e.target.value);
        setDraft(masked);
        if (/^\d{2}\/\d{2}\/\d{4}$/.test(masked)) {
          onChange(parseBrDateToIso(masked));
        } else if (!masked.trim()) {
          onChange('');
        }
      }}
      onBlur={() => {
        setFocused(false);
        setDraft('');
        if (draft && !/^\d{2}\/\d{2}\/\d{4}$/.test(draft)) {
          onChange('');
        }
      }}
      className={cn(formControlDateClassName, className)}
    />
  );
}

/** Hora 24h (HH:mm) — padrão brasileiro, sem AM/PM do navegador. */
export function BrTimeInput({ value, onChange, className, disabled, placeholder = 'HH:mm', ...rest }: BrScheduleFieldProps) {
  const [focused, setFocused] = useState(false);
  const [draft, setDraft] = useState('');

  const displayValue = focused ? draft : normalizeTimeBr(value);

  return (
    <input
      {...rest}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      placeholder={placeholder}
      value={displayValue}
      onFocus={() => {
        setFocused(true);
        setDraft(normalizeTimeBr(value));
      }}
      onChange={(e) => {
        const masked = maskBrTimeInput(e.target.value);
        setDraft(masked);
        if (/^\d{2}:\d{2}$/.test(masked)) {
          onChange(normalizeTimeBr(masked));
        }
      }}
      onBlur={() => {
        setFocused(false);
        const normalized = normalizeTimeBr(draft);
        if (/^\d{2}:\d{2}$/.test(normalized)) {
          onChange(normalized);
        }
        setDraft('');
      }}
      className={cn(formControlTimeClassName, className)}
    />
  );
}

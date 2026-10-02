import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Padrão canônico de campo — alinhado ao Revive (bg-background/40, focus primary).
 * Preferir este helper em vez de classes raw em inputs de formulário.
 */
export const formControlClassName = cn(
  'flex w-full min-w-0 rounded-md border border-border bg-background/40 px-3 py-2 text-sm transition-colors outline-none',
  'placeholder:text-muted-foreground',
  'focus-visible:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/20',
  'disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
  'aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20'
);

export const formControlSizes = {
  sm: 'h-8 text-xs',
  md: 'h-9 text-sm',
  lg: 'h-10 text-sm',
} as const;

export type FormControlProps = React.ComponentProps<'input'> & {
  inputSize?: keyof typeof formControlSizes;
};

export const FormControl = React.forwardRef<HTMLInputElement, FormControlProps>(
  function FormControl({ className, inputSize = 'md', type = 'text', ...props }, ref) {
    const isDateLike = type === 'date' || type === 'month' || type === 'datetime-local' || type === 'time';
    return (
      <input
        ref={ref}
        type={type}
        data-slot="form-control"
        className={cn(
          formControlClassName,
          formControlSizes[inputSize],
          isDateLike && 'text-foreground [color-scheme:dark]',
          className
        )}
        {...props}
      />
    );
  }
);

export const formTextareaClassName = cn(
  formControlClassName,
  'min-h-[4.5rem] resize-y py-2',
  'h-auto'
);

/** Campos compactos (grades de horário, exceções). */
export const formControlCompactClassName = cn(formControlClassName, formControlSizes.sm, 'px-3');
/** Revive `EntregadorCadastro` — `h-8 w-28` / `h-8 w-40` sem pill. */
export const formControlTimeClassName = cn(formControlCompactClassName, 'h-8 w-28');
export const formControlDateClassName = cn(formControlCompactClassName, 'h-8 w-40');
export const formControlFlexClassName = cn(formControlCompactClassName, 'h-8 flex-1');

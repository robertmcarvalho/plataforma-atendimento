import * as React from 'react';
import { cn } from '@/lib/utils';

type SwitchProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> & {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (next: boolean) => void;
};

export const Switch = React.forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { checked, defaultChecked, onCheckedChange, className, disabled, ...props },
  ref
) {
  const [internal, setInternal] = React.useState(Boolean(defaultChecked));
  const isControlled = typeof checked === 'boolean';
  const value = isControlled ? Boolean(checked) : internal;

  const setValue = (next: boolean) => {
    if (!isControlled) setInternal(next);
    onCheckedChange?.(next);
  };

  return (
    <button
      ref={ref}
      type="button"
      role="switch"
      aria-checked={value}
      disabled={disabled}
      onClick={() => setValue(!value)}
      className={cn(
        'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        value ? 'bg-primary' : 'bg-input',
        disabled ? 'opacity-50 cursor-not-allowed pointer-events-none' : '',
        className
      )}
      {...props}
    >
      <span
        aria-hidden
        className={cn(
          'pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform',
          value ? 'translate-x-5' : 'translate-x-0'
        )}
      />
    </button>
  );
});

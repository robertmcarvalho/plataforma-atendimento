import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { CadastroBackLink } from '@/components/cadastro/CadastroPrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { cn } from '@/lib/utils';

export const billingPageStackClassName = 'space-y-4';

export const billingPanelClassName = 'rounded-lg border border-border bg-surface p-5';
export const billingDialogGridClassName = 'grid gap-4 md:grid-cols-2';
export const billingDialogSectionClassName = 'space-y-4';

export function BillingDialogContent({
  title,
  description,
  children,
  footer,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <DialogContent
      className={cn(
        'max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-md sm:max-w-lg',
        className
      )}
    >
      <DialogHeader className="mb-2 gap-1">
        <DialogTitle className="text-lg font-semibold tracking-tight">{title}</DialogTitle>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </DialogHeader>
      <div className="space-y-4">{children}</div>
      {footer ? <DialogFooter className="gap-3 pt-2 sm:justify-stretch">{footer}</DialogFooter> : null}
    </DialogContent>
  );
}

export function BillingCadastroPage({
  backHref,
  backLabel,
  title,
  description,
  eyebrow = 'Faturamento',
  icon,
  actions,
  children,
}: {
  backHref: string;
  backLabel: string;
  title: string;
  description?: string;
  eyebrow?: string;
  icon?: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-5xl">
      <CadastroBackLink href={backHref}>{backLabel}</CadastroBackLink>
      <PageHeader
        compact
        icon={icon}
        eyebrow={eyebrow}
        title={title}
        description={description}
        actions={actions}
      />
      <div className={billingPageStackClassName}>{children}</div>
    </div>
  );
}

export function BillingSection({
  title,
  desc,
  icon: Icon,
  action,
  children,
  className,
}: {
  title: string;
  desc?: string;
  icon?: LucideIcon;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn(billingPanelClassName, className)}>
      <div className="mb-4 flex items-end justify-between gap-3 border-b border-border pb-3">
        <div className="flex min-w-0 items-start gap-3">
          {Icon ? (
            <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
              <Icon className="h-4 w-4" strokeWidth={1.75} />
            </div>
          ) : null}
          <div className="min-w-0 space-y-0.5">
            <h2 className="text-sm font-semibold text-foreground">{title}</h2>
            {desc ? <p className="text-xs text-muted-foreground">{desc}</p> : null}
          </div>
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function BillingFormSection({
  title,
  desc,
  icon,
  children,
  className,
}: {
  title: string;
  desc?: string;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
}) {
  return (
    <BillingSection title={title} desc={desc} icon={icon} className={className}>
      {children}
    </BillingSection>
  );
}

export function BillingSwitchRow({
  checked,
  onChange,
  label,
  description,
  disabled,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        'flex min-h-10 items-center justify-between gap-3 rounded-lg border border-border bg-background/40 px-3 py-2 text-xs',
        disabled && 'cursor-not-allowed opacity-60'
      )}
    >
      <span className="min-w-0">
        <span className="block font-medium text-foreground">{label}</span>
        {description ? <span className="mt-0.5 block text-[11px] text-muted-foreground">{description}</span> : null}
      </span>
      <input
        type="checkbox"
        className="h-4 w-4 shrink-0 accent-primary"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

export function BillingField({
  label,
  icon: Icon,
  required,
  children,
  className,
}: {
  label: string;
  icon?: LucideIcon;
  required?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1.5', className)}>
      <label className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-subtle-foreground">
        {Icon ? <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden /> : null}
        <span>{label}</span>
        {required ? <span className="text-destructive">*</span> : null}
      </label>
      {children}
    </div>
  );
}

export function BillingEmptyState({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-lg border border-dashed border-border bg-background/40 px-3 py-8 text-center text-xs text-muted-foreground', className)}>
      {children}
    </div>
  );
}

export function BillingActionFeedbackDialog({
  open,
  onOpenChange,
  title,
  description,
  items,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  items?: ReactNode[];
}) {
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto rounded-lg border border-border bg-card p-6 shadow-md sm:max-w-md">
      <DialogHeader className="mb-2 gap-1">
        <DialogTitle className="text-lg font-semibold tracking-tight">{title}</DialogTitle>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </DialogHeader>
      {items?.length ? (
        <div className="space-y-2">
          {items.map((item, idx) => (
            <div key={idx} className="rounded-lg border border-border bg-background/40 px-3 py-2 text-xs">
              {item}
            </div>
          ))}
        </div>
      ) : null}
      <DialogFooter className="gap-3 pt-4 sm:justify-stretch">
        <button
          type="button"
          className="flex-1 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          onClick={() => onOpenChange(false)}
        >
          Entendi
        </button>
      </DialogFooter>
    </DialogContent>
  );
}

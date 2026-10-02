'use client';

import { FormControl } from '@/components/form/FormControl';
import { cn } from '@/lib/utils';

export function SettingsField({
  label,
  value,
  onChange,
  mono,
  readOnly,
  list,
}: {
  label: string;
  value: string;
  onChange?: (v: string) => void;
  mono?: boolean;
  readOnly?: boolean;
  /** id de um `<datalist>` no mesmo documento */
  list?: string;
}) {
  return (
    <div>
      <label className="text-[10px] font-medium uppercase tracking-wider text-subtle-foreground">{label}</label>
      <FormControl
        value={value}
        readOnly={readOnly}
        list={list}
        onChange={(e) => onChange?.(e.target.value)}
        className={cn('mt-1', mono && 'font-mono', readOnly && 'cursor-not-allowed opacity-80')}
      />
    </div>
  );
}

const COMMON_TIMEZONES = [
  'America/Sao_Paulo',
  'America/Fortaleza',
  'America/Manaus',
  'America/Recife',
  'America/Belem',
  'America/Bahia',
  'America/Campo_Grande',
  'America/Cuiaba',
  'UTC',
  'Europe/Lisbon',
  'Europe/London',
];

export function SettingsPlaceholderCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-background p-12 text-center">
      <p className="text-sm font-semibold tracking-tight text-foreground">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{description}</p>
      <p className="mt-4 text-[11px] text-subtle-foreground">Em breve nesta versão.</p>
    </div>
  );
}

type WorkspacePanelProps = {
  workspaceName: string;
  slug: string;
  cnpj: string;
  logoUrl?: string;
  timezone: string;
  onTimezoneChange: (v: string) => void;
  canEditTimezone: boolean;
  onSaveTimezone: () => void;
  saving: boolean;
  note: string | null;
  noteTone?: 'ok' | 'err';
  canEditIdentity?: boolean;
  onWorkspaceNameChange?: (v: string) => void;
  onSlugChange?: (v: string) => void;
  onCnpjChange?: (v: string) => void;
  onLogoUrlChange?: (v: string) => void;
  onSaveIdentity?: () => void;
  identitySaving?: boolean;
  identityNote?: string | null;
  identityNoteTone?: 'ok' | 'err';
  loading?: boolean;
  loadError?: string | null;
  onRetryLoad?: () => void;
};

export function SettingsWorkspaceIdentityPanel({
  workspaceName,
  slug,
  cnpj,
  logoUrl = '',
  timezone,
  onTimezoneChange,
  canEditTimezone,
  onSaveTimezone,
  saving,
  note,
  noteTone,
  canEditIdentity = false,
  onWorkspaceNameChange,
  onSlugChange,
  onCnpjChange,
  onLogoUrlChange,
  onSaveIdentity,
  identitySaving = false,
  identityNote = null,
  identityNoteTone = 'ok',
  loading = false,
  loadError = null,
  onRetryLoad,
}: WorkspacePanelProps) {
  const initial = (workspaceName || 'W').trim().charAt(0).toUpperCase();

  if (loading) {
    return (
      <div className="space-y-4 animate-pulse">
        <div className="flex gap-4">
          <div className="h-16 w-16 rounded-xl bg-muted" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-32 rounded bg-muted" />
            <div className="h-9 w-full rounded-md bg-muted" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="h-16 rounded-md bg-muted" />
          <div className="h-16 rounded-md bg-muted" />
          <div className="h-16 rounded-md bg-muted" />
          <div className="h-16 rounded-md bg-muted" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm">
        <p className="font-medium text-destructive">{loadError}</p>
        {onRetryLoad ? (
          <button
            type="button"
            onClick={() => void onRetryLoad()}
            className="mt-3 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-sidebar-accent/60"
          >
            Tentar novamente
          </button>
        ) : null}
      </div>
    );
  }

  return (
    <div>
      <datalist id="workspace-common-timezones">
        {COMMON_TIMEZONES.map((tz) => (
          <option key={tz} value={tz} />
        ))}
      </datalist>
      <div className="space-y-5">
        <div className="flex items-center gap-4">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-16 w-16 rounded-xl border border-border object-cover" />
          ) : (
            <div className="flex h-16 w-16 items-center justify-center rounded-xl bg-gradient-primary text-2xl font-bold text-primary-foreground shadow-md">
              {initial}
            </div>
          )}
          <div className="min-w-0 flex-1">
            {canEditIdentity && onLogoUrlChange ? (
              <>
                <SettingsField label="URL do logo (opcional)" value={logoUrl} onChange={onLogoUrlChange} mono />
                <p className="mt-1 text-[10px] text-subtle-foreground">PNG ou SVG público por URL. Upload direto em breve.</p>
              </>
            ) : (
              <p className="text-[11px] text-muted-foreground">Logo definido pelo URL acima (se existir).</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <SettingsField
            label="Nome do workspace"
            value={workspaceName}
            readOnly={!canEditIdentity}
            onChange={canEditIdentity ? onWorkspaceNameChange : undefined}
          />
          <SettingsField
            label="Slug (URL)"
            value={slug}
            mono
            readOnly={!canEditIdentity}
            onChange={canEditIdentity ? onSlugChange : undefined}
          />
          <SettingsField
            label="CNPJ"
            value={cnpj}
            mono
            readOnly={!canEditIdentity}
            onChange={canEditIdentity ? onCnpjChange : undefined}
          />
          <SettingsField
            label="Fuso horário (IANA)"
            value={timezone}
            onChange={canEditTimezone ? onTimezoneChange : undefined}
            readOnly={!canEditTimezone}
            list={canEditTimezone ? 'workspace-common-timezones' : undefined}
          />
        </div>

        {canEditIdentity && onSaveIdentity ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={identitySaving}
              onClick={() => void onSaveIdentity()}
              className="rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {identitySaving ? 'Salvando…' : 'Salvar identidade'}
            </button>
            {identityNote ? (
              <p
                className={cn(
                  'text-xs font-medium',
                  identityNoteTone === 'err' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'
                )}
              >
                {identityNote}
              </p>
            ) : null}
          </div>
        ) : null}

        {canEditTimezone ? (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSaveTimezone()}
              className="rounded-md border border-border bg-background/40 px-3 py-1.5 text-xs font-medium text-foreground hover:bg-sidebar-accent/60 disabled:opacity-50"
            >
              {saving ? 'Salvando…' : 'Salvar fuso'}
            </button>
            {note ? (
              <p
                className={cn(
                  'text-xs font-medium',
                  noteTone === 'err' ? 'text-destructive' : 'text-emerald-600 dark:text-emerald-400'
                )}
              >
                {note}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            Fuso horário global: apenas administradores podem alterar (<span className="font-mono">workspace_timezone</span>).
          </p>
        )}
      </div>
    </div>
  );
}

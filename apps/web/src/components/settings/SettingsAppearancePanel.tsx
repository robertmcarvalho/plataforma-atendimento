'use client';

import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';
import { useInboxDensity, type InboxDensity } from '@/hooks/useInboxDensity';

const THEME_OPTIONS: { value: ThemePreference; label: string; desc: string }[] = [
  { value: 'dark', label: 'Escuro', desc: 'Tema atual da plataforma' },
  { value: 'light', label: 'Claro', desc: 'Alto contraste para ambientes claros' },
  { value: 'system', label: 'Sistema', desc: 'Segue o modo do dispositivo' },
];

const INBOX_DENSITY_OPTIONS: { value: InboxDensity; label: string; desc: string }[] = [
  { value: 'compact', label: 'Compacto', desc: 'Mais conversas visíveis na lista (padrão)' },
  { value: 'comfort', label: 'Confortável', desc: 'Textos maiores na inbox para leitura prolongada' },
];

export function SettingsAppearancePanel() {
  const { preference, setPreference } = useThemePreference();
  const { density, setDensity } = useInboxDensity();
  const authedUser = useAuth((s) => s.user);

  const pickTheme = (next: ThemePreference) => {
    setPreference(next);
    if (authedUser) {
      void api.patch('/api/users/me', { ui_preferences: { theme: next } }).catch(() => undefined);
    }
  };

  const pickInboxDensity = (next: InboxDensity) => {
    setDensity(next);
    if (authedUser) {
      void api.patch('/api/users/me', { ui_preferences: { inbox_density: next } }).catch(() => undefined);
    }
  };

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Tema</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Sincroniza com a sua conta quando estiver autenticado; também fica guardado neste navegador.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-3">
          {THEME_OPTIONS.map((opt) => {
            const active = preference === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => pickTheme(opt.value)}
                className={cn(
                  'rounded-xl border px-4 py-3 text-left transition-colors',
                  active ? 'border-primary bg-primary/10 ring-2 ring-primary/25' : 'border-border bg-surface hover:bg-surface-hover'
                )}
              >
                <p className="text-sm font-semibold text-foreground">{opt.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{opt.desc}</p>
              </button>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Densidade da inbox</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Ajusta o tamanho dos textos na caixa de entrada. Útil para quem passa o dia no atendimento.
          </p>
        </div>
        <div className="grid gap-2 sm:grid-cols-2">
          {INBOX_DENSITY_OPTIONS.map((opt) => {
            const active = density === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => pickInboxDensity(opt.value)}
                className={cn(
                  'rounded-xl border px-4 py-3 text-left transition-colors',
                  active ? 'border-primary bg-primary/10 ring-2 ring-primary/25' : 'border-border bg-surface hover:bg-surface-hover'
                )}
              >
                <p className="text-sm font-semibold text-foreground">{opt.label}</p>
                <p className="mt-1 text-xs text-muted-foreground">{opt.desc}</p>
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}

'use client';

import api from '@/lib/api';
import { cn } from '@/lib/utils';
import { useAuth } from '@/store/auth';
import { useThemePreference, type ThemePreference } from '@/hooks/useThemePreference';
import { useInboxDensity, type InboxDensity } from '@/hooks/useInboxDensity';
import { Card, CardContent } from '@/components/ui/card';

const THEME_OPTIONS: { value: ThemePreference; label: string; desc: string }[] = [
  { value: 'dark', label: 'Escuro', desc: 'Tema atual da plataforma' },
  { value: 'light', label: 'Claro', desc: 'Alto contraste para ambientes claros' },
  { value: 'system', label: 'Sistema', desc: 'Segue o modo do dispositivo' },
];

const INBOX_DENSITY_OPTIONS: { value: InboxDensity; label: string; desc: string }[] = [
  { value: 'compact', label: 'Compacto', desc: 'Mais conversas visíveis na lista (padrão)' },
  { value: 'comfort', label: 'Confortável', desc: 'Textos maiores na inbox para leitura prolongada' },
];

function OptionCard({
  active,
  label,
  desc,
  onClick,
}: {
  active: boolean;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border px-4 py-3 text-left transition-colors',
        active ? 'border-primary bg-primary/10 ring-2 ring-primary/25' : 'border-border bg-background hover:bg-sidebar-accent/60'
      )}
    >
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <p className="mt-1 text-xs text-muted-foreground">{desc}</p>
    </button>
  );
}

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
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Tema</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Sincroniza com a sua conta quando estiver autenticado; também fica guardado neste navegador.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            {THEME_OPTIONS.map((opt) => (
              <OptionCard
                key={opt.value}
                active={preference === opt.value}
                label={opt.label}
                desc={opt.desc}
                onClick={() => pickTheme(opt.value)}
              />
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-4 p-5">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Densidade da inbox</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              Ajusta o tamanho dos textos na caixa de entrada. Útil para quem passa o dia no atendimento.
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {INBOX_DENSITY_OPTIONS.map((opt) => (
              <OptionCard
                key={opt.value}
                active={density === opt.value}
                label={opt.label}
                desc={opt.desc}
                onClick={() => pickInboxDensity(opt.value)}
              />
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

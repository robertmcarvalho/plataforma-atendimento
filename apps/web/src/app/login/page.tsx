'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2, Lock, Mail } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { Logo } from '@/components/branding/Logo';
import { BRANDING_MARK_DARK } from '@/lib/brandingAssets';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const { login } = useAuth();
  const router = useRouter();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      await login(email, password);
      router.push('/inbox');
    } catch (err: unknown) {
      const ax = err as { response?: { data?: { error?: string; message?: string } } };
      const apiMsg = ax?.response?.data?.error || ax?.response?.data?.message;
      setError(
        apiMsg
          ? String(apiMsg)
          : 'Nao foi possivel autenticar com as credenciais informadas.'
      );
    } finally {
      setLoading(false);
    }
  };

  const year = new Date().getFullYear();
  const darkThemeVars = {
    '--background': '240 6% 4%',
    '--surface': '240 5% 7%',
    '--surface-elevated': '240 5% 10%',
    '--surface-hover': '240 5% 12%',
    '--foreground': '0 0% 98%',
    '--muted': '240 4% 14%',
    '--muted-foreground': '240 5% 60%',
    '--subtle-foreground': '240 5% 45%',
    '--card': '240 5% 7%',
    '--border': '240 5% 14%',
    '--primary': '220 100% 62%',
    '--primary-foreground': '0 0% 100%',
    '--primary-glow': '220 100% 70%',
    '--destructive': '0 75% 60%',
    '--channel-instagram': '320 75% 60%',
  } as React.CSSProperties;

  return (
    <main
      className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground"
      style={darkThemeVars}
    >
      {/* Mesh + grid */}
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 h-[480px] w-[480px] animate-pulse rounded-full bg-primary/30 blur-[120px]" />
        <div
          className="absolute top-1/3 -right-40 h-[520px] w-[520px] animate-pulse rounded-full bg-[hsl(var(--channel-instagram)/0.2)] blur-[120px]"
          style={{ animationDelay: '1.5s', animationDuration: '5s' }}
        />
        <div
          className="absolute -bottom-40 left-1/4 h-[460px] w-[460px] animate-pulse rounded-full bg-primary/25 blur-[120px]"
          style={{ animationDelay: '2.8s', animationDuration: '6s' }}
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, hsl(var(--foreground)) 1px, transparent 1px), linear-gradient(to bottom, hsl(var(--foreground)) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/80" />
      </div>

      <div className="relative w-full max-w-[400px]">
        {/* Brand */}
        <div className="mb-8 flex flex-col items-center">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center">
              <Logo variant="mark" width={56} priority appearance="dark" className="relative z-[1]" />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center opacity-50 blur-lg"
              >
                {/* Evita segundo <Image> LCP; mesmo asset só para glow */}
                <img src={BRANDING_MARK_DARK} alt="" width={56} height={56} className="h-14 w-14 object-contain" />
              </div>
            </div>
            <span className="text-2xl font-semibold tracking-tight">Aethera</span>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">Plataforma omnichannel inteligente</p>
          <p className="mt-1 max-w-[320px] text-center font-mono text-[9px] uppercase leading-snug tracking-wider text-[hsl(var(--primary)/0.85)]">
            Suporte inteligente · Gestão eficiente · Resultados reais
          </p>
        </div>

        {/* Glass card */}
        <div className="relative rounded-2xl border border-white/10 bg-surface/40 p-7 shadow-[0_20px_70px_-20px_hsl(var(--primary)/0.25)] backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.06] to-transparent" />

          <div className="relative">
            <div className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">Entrar</div>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Bem-vindo de volta</h2>
            <p className="mt-1 text-xs text-muted-foreground">Acesse seu workspace para continuar.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="text-xs font-medium text-muted-foreground" htmlFor="login-email">
                  E-mail
                </label>
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2.5 backdrop-blur transition-all focus-within:border-primary/50 focus-within:ring-glow">
                  <Mail size={16} className="shrink-0 text-muted-foreground" />
                  <input
                    id="login-email"
                    name="username"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@empresa.com"
                    autoComplete="username"
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between gap-2">
                  <label className="text-xs font-medium text-muted-foreground" htmlFor="login-password">
                    Senha
                  </label>
                  <span className="cursor-not-allowed text-[10px] text-muted-foreground opacity-60" title="Em breve">
                    Esqueci a senha
                  </span>
                </div>
                <div className="mt-1.5 flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2.5 backdrop-blur transition-all focus-within:border-primary/50 focus-within:ring-glow">
                  <Lock size={16} className="shrink-0 text-muted-foreground" />
                  <input
                    id="login-password"
                    name="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="w-full bg-transparent text-sm text-foreground outline-none placeholder:text-subtle-foreground"
                  />
                </div>
              </div>

              {error ? (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
                  <AlertCircle size={16} className="mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              ) : null}

              <button
                id="btn-login"
                type="submit"
                disabled={loading}
                className="group flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground shadow-glow transition-all hover:bg-primary-glow disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    Entrar
                    <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                  </>
                )}
              </button>
            </form>
          </div>
        </div>

        <p className="mt-8 text-center font-mono text-[10px] text-subtle-foreground">
          © {year} Aethera · Todos os direitos reservados
        </p>
      </div>
    </main>
  );
}

'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Loader2, Lock, Mail } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { Logo } from '@/components/branding/Logo';
import { BRANDING_MARK_DARK } from '@/lib/brandingAssets';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert, AlertDescription } from '@/components/ui/alert';

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

  return (
    <main className="relative flex min-h-screen w-full items-center justify-center overflow-hidden bg-background px-4 py-12 text-foreground">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-32 -left-32 h-[480px] w-[480px] animate-pulse rounded-full bg-primary/25 blur-[120px]" />
        <div
          className="absolute top-1/3 -right-40 h-[520px] w-[520px] animate-pulse rounded-full bg-channel-instagram/20 blur-[120px]"
          style={{ animationDelay: '1.5s', animationDuration: '5s' }}
        />
        <div
          className="absolute -bottom-40 left-1/4 h-[460px] w-[460px] animate-pulse rounded-full bg-primary/20 blur-[120px]"
          style={{ animationDelay: '2.8s', animationDuration: '6s' }}
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--foreground) 1px, transparent 1px), linear-gradient(to bottom, var(--foreground) 1px, transparent 1px)',
            backgroundSize: '44px 44px',
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-transparent to-background/80" />
      </div>

      <div className="relative w-full max-w-[400px]">
        <div className="mb-8 flex flex-col items-center">
          <div className="flex items-center gap-2.5">
            <div className="relative flex items-center justify-center">
              <Logo variant="mark" width={56} priority appearance="dark" className="relative z-[1]" />
              <div
                aria-hidden
                className="pointer-events-none absolute inset-0 -z-10 flex items-center justify-center opacity-50 blur-lg"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={BRANDING_MARK_DARK} alt="" width={56} height={56} className="h-14 w-14 object-contain" />
              </div>
            </div>
            <span className="text-2xl font-semibold tracking-tight">Aethera</span>
          </div>
          <p className="mt-3 text-center text-xs text-muted-foreground">Plataforma omnichannel inteligente</p>
          <p className="mt-1 max-w-[320px] text-center font-mono text-[9px] uppercase leading-snug tracking-wider text-primary/85">
            Suporte inteligente · Gestão eficiente · Resultados reais
          </p>
        </div>

        <div className="relative rounded-2xl border border-white/10 bg-surface/40 p-7 shadow-[0_20px_70px_-20px_hsl(var(--primary)/0.25)] backdrop-blur-2xl">
          <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-white/[0.06] to-transparent" />
          <div className="relative">
            <p className="font-mono text-[10px] uppercase tracking-wider text-subtle-foreground">Entrar</p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight">Bem-vindo de volta</h2>
            <p className="mt-1 text-xs text-muted-foreground">Acesse seu workspace para continuar.</p>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">E-mail</Label>
                <div className="relative">
                  <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="login-email"
                    name="username"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="voce@empresa.com"
                    autoComplete="username"
                    className="pl-9"
                  />
                </div>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="login-password">Senha</Label>
                  <span className="cursor-not-allowed text-[10px] text-muted-foreground opacity-60" title="Em breve">
                    Esqueci a senha
                  </span>
                </div>
                <div className="relative">
                  <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="login-password"
                    name="password"
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                    className="pl-9"
                  />
                </div>
              </div>

              {error ? (
                <Alert variant="destructive">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    Entrando...
                  </>
                ) : (
                  <>
                    Entrar
                    <ArrowRight className="h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </form>
          </div>
        </div>

        <p className="mt-8 text-center font-mono text-[10px] text-muted-foreground">
          © {year} Aethera · Todos os direitos reservados
        </p>
      </div>
    </main>
  );
}

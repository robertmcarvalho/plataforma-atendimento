import Link from 'next/link';
import { ShieldOff } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { buttonVariants } from '@/components/ui/button';

export function CommercialForbidden({ role }: { role?: string }) {
  return (
    <div className="mx-auto max-w-lg px-4 py-16">
      <PageHeader
        compact
        title="Sem permissão comercial"
        description={
          role
            ? `O perfil “${role}” não tem acesso ao módulo Comercial. Papéis permitidos: admin, supervisor, sales, commercial.`
            : 'Você não tem permissão para acessar o módulo Comercial.'
        }
      />
      <div className="mt-6 flex flex-col items-center rounded-xl border border-border bg-card p-8 text-center">
        <ShieldOff className="h-10 w-10 text-muted-foreground" aria-hidden />
        <p className="mt-4 text-sm text-muted-foreground">
          Entre com um usuário comercial ou peça ao administrador para habilitar seu perfil.
        </p>
        <Link href="/inbox" className={`mt-6 ${buttonVariants({ variant: 'outline', size: 'sm' })}`}>
          Voltar à caixa de entrada
        </Link>
      </div>
    </div>
  );
}

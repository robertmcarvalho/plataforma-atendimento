'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { ArrowLeft, ListTree } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { CatalogsEditor } from '@/components/automacoes/CatalogsEditor';

export default function AutomacoesCatalogosPage() {
  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="border-b border-border px-6 py-4">
        <Link href="/automacoes" className="mb-4 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" />
          Automações
        </Link>
        <PageHeader
          icon={ListTree}
          eyebrow="Motor de atendimento"
          title="Catálogos de atendimento"
          description="Perfis, setores, mensagens do bot, SLA e fora do horário — demandas ficam nos webhooks dos canais."
        />
      </div>
      <div className="flex-1 overflow-auto p-6">
        <Suspense fallback={<p className="text-sm text-muted-foreground">Carregando catálogos…</p>}>
          <CatalogsEditor />
        </Suspense>
      </div>
    </div>
  );
}

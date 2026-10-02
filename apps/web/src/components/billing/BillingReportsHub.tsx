'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Banknote, FileSpreadsheet, ShieldCheck, Users, BarChart3, Download } from 'lucide-react';
import {
  BILLING_EXPORT_REPORT_CARDS,
  BillingReportExportDialog,
  type BillingReportExportKind,
} from '@/components/billing/BillingReportExportDialog';

const linkCards = [
  {
    href: '/billing/dre',
    title: 'DRE gerencial',
    description: 'Demonstrativo por competência — CoopMob e Flux Farma (cutover 07/2026).',
    icon: BarChart3,
    tone: 'bg-primary/15 text-primary',
  },
  {
    href: '/billing/relatorios/inss-contabilidade',
    title: 'INSS — Contabilidade',
    description: 'Lista mensal de cooperados (nome, CPF, valor faturado) para envio ao contador.',
    icon: FileSpreadsheet,
    tone: 'bg-primary/15 text-primary',
  },
  {
    href: '/billing/relatorios/seguradora',
    title: 'Seguradora',
    description: 'Cooperados ativos na data de corte + desligados no mês de competência.',
    icon: ShieldCheck,
    tone: 'bg-success/15 text-success',
  },
  {
    href: '/billing/relatorios/pagamento-pix',
    title: 'Pagamentos em lote (acerto)',
    description: 'PIX/C6 de APs elegíveis — exclui diárias (use o relatório de diárias).',
    icon: Banknote,
    tone: 'bg-warning/15 text-warning',
  },
  {
    href: '/billing/relatorios/pagamento-pix-diarias',
    title: 'PIX — Diárias (terça)',
    description: 'Trilha própria: export C6 das diárias do Financeiro + APs para baixa.',
    icon: Download,
    tone: 'bg-success/15 text-success',
  },
  {
    href: '/billing/relatorios/comissoes-lideres',
    title: 'Comissões líderes Flux',
    description: 'Margem Flux por farmácia e comissão de operação (venc. dia 15).',
    icon: Users,
    tone: 'bg-channel-instagram/15 text-channel-instagram',
  },
  {
    href: '/billing/relatorios/comissoes',
    title: 'Comissões parceiros',
    description: 'Provisões por conversão de lead e exportação para pagamento.',
    icon: Users,
    tone: 'bg-muted text-muted-foreground',
  },
] as const;

export function BillingReportsHub() {
  const [exportKind, setExportKind] = useState<BillingReportExportKind | null>(null);

  return (
    <div>
      <div className="grid gap-4 md:grid-cols-3">
        {BILLING_EXPORT_REPORT_CARDS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setExportKind(c.id)}
            className="group rounded-xl border border-border bg-surface p-5 text-left transition-colors hover:border-primary/40 hover:bg-surface-hover"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.tone}`}>
              <c.icon className="h-4 w-4" />
            </div>
            <h3 className="mt-3 text-sm font-semibold">{c.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
            <div className="mt-3 flex items-center gap-1 text-[11px] font-medium text-primary group-hover:underline">
              <Download className="h-3 w-3" /> Configurar exportação
            </div>
          </button>
        ))}

        {linkCards.map((c) => (
          <Link
            key={c.href}
            href={c.href}
            className="group rounded-xl border border-border bg-surface p-5 transition-colors hover:border-primary/40 hover:bg-surface-hover"
          >
            <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${c.tone}`}>
              <c.icon className="h-4 w-4" />
            </div>
            <h3 className="mt-3 text-sm font-semibold">{c.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{c.description}</p>
            <div className="mt-3 text-[11px] font-medium text-primary group-hover:underline">Abrir →</div>
          </Link>
        ))}
      </div>

      <p className="mt-6 text-[11px] text-muted-foreground">
        Capital cooperativo, cotas e prestadores geram arquivo Excel (CSV) com filtros. Demais relatórios abrem na tela dedicada.
      </p>

      <BillingReportExportDialog
        kind={exportKind}
        open={exportKind !== null}
        onOpenChange={(open) => {
          if (!open) setExportKind(null);
        }}
      />
    </div>
  );
}

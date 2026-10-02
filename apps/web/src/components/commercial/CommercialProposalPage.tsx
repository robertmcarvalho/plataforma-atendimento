'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { Download, FileText, MessageCircle, RefreshCw, Save } from 'lucide-react';
import { CadastroBackLink } from '@/components/cadastro/CadastroPrimitives';
import { PageHeader } from '@/components/ui/PageHeader';
import { formatRelativeDate } from '@/lib/commercial/commercialFormat';
import {
  downloadProposalDocx,
  downloadProposalPdf,
  fetchProposalPdfBlob,
} from '@/lib/commercial/commercialApi';
import { ownerName } from '@/lib/commercial/commercialOwners';
import {
  useCommercialOwners,
  useLead,
  useProposal,
  useRegenerateProposal,
  useSaveProposalNotes,
  useSendProposal,
} from '@/lib/commercial/useCommercialQueries';
import { CommercialListSkeleton } from '@/components/commercial/CommercialSkeleton';
import { Button, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import type { ProposalDocumentVars } from '@/lib/commercial/types';

type Props = { proposalId: string };

export function CommercialProposalPage({ proposalId }: Props) {
  const { data: proposal, isLoading, refetch } = useProposal(proposalId);
  const { data: lead } = useLead(proposal?.lead_id);
  const { data: owners = [] } = useCommercialOwners();
  const sendProposal = useSendProposal();
  const regenerate = useRegenerateProposal();
  const saveNotes = useSaveProposalNotes();

  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);

  const pdfReady =
    proposal?.status === 'pdf_ready' || proposal?.has_pdf || Boolean(proposal?.pdf_generated_at);

  const documentSource = proposal?.document_source as
    | { vars?: ProposalDocumentVars; template_version?: number }
    | null
    | undefined;
  const vars = documentSource?.vars;

  useEffect(() => {
    setNotes(proposal?.notes ?? '');
  }, [proposal?.notes, proposal?.id]);

  useEffect(() => {
    if (!pdfReady || !proposal?.id) {
      setPdfPreviewUrl(null);
      return;
    }
    let revoked: string | null = null;
    let cancelled = false;
    void fetchProposalPdfBlob(proposal.id, true)
      .then(({ blob }) => {
        if (cancelled) return;
        revoked = URL.createObjectURL(blob);
        setPdfPreviewUrl(revoked);
      })
      .catch(() => {
        if (!cancelled) setPdfPreviewUrl(null);
      });
    return () => {
      cancelled = true;
      if (revoked) URL.revokeObjectURL(revoked);
    };
  }, [proposal?.id, pdfReady, proposal?.pdf_generated_at, proposal?.status]);

  const legacyHtmlOnly = Boolean(proposal?.document_html?.trim()) && !pdfReady;

  const handleRegenerate = async () => {
    if (
      !window.confirm(
        'Regenerar a proposta a partir da viabilidade atual? O PDF será substituído pelo modelo Royal Farma.',
      )
    ) {
      return;
    }
    setError(null);
    try {
      await regenerate.mutateAsync(proposalId);
      await refetch();
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const handleSaveNotes = async () => {
    setError(null);
    try {
      await saveNotes.mutateAsync({ proposalId, notes: notes.trim() || null });
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const handleSend = async () => {
    setError(null);
    try {
      await sendProposal.mutateAsync(proposalId);
    } catch (e) {
      setError(apiErrorMessage(e));
    }
  };

  const summaryRows = useMemo(() => {
    if (!vars) return [];
    return [
      ['Cliente', vars.nome_fantasia],
      ['CNPJ', vars.cnpj],
      ['Taxa/entrega', `R$ ${vars.taxa_1}`],
      ['Mín. garantido/entregador/sem', `R$ ${vars.minimo_garantido}`],
      ['Entregas mín./sem (por entreg.)', vars.qt_entregas],
      ['Setup', `R$ ${vars.setup}`],
      ['Pagamento setup', vars.setup_pagamento],
      ['Entregadores', vars.qt_entregadores],
      ['Diárias/semana', vars.qt_diarias_semana],
    ] as const;
  }, [vars]);

  if (isLoading) {
    return <CommercialListSkeleton rows={6} />;
  }

  if (!proposal || !lead) {
    return <p className="p-8 text-sm text-muted-foreground">Proposta não encontrada.</p>;
  }

  const statusLabel =
    proposal.status === 'draft'
      ? 'Rascunho (PDF pendente)'
      : proposal.status === 'pdf_ready'
        ? 'PDF pronto'
        : proposal.status === 'sent'
          ? 'Enviada'
          : 'Aceita';

  return (
    <div className="mx-auto max-w-6xl">
      <CadastroBackLink href={`/commercial/leads/${lead.id}`}>Voltar para ficha do lead</CadastroBackLink>
      <PageHeader
        icon={FileText}
        eyebrow="Comercial · Proposta"
        title={`${proposal.package_name} — v${proposal.version}`}
        description={`${lead.trade_name} · ${ownerName(lead.owner_id, owners)}`}
      />

      {error ? <p className="mb-3 text-sm text-destructive">{error}</p> : null}

      {legacyHtmlOnly ? (
        <p className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm text-warning">
          Proposta legada (HTML). Clique em &quot;Regenerar proposta&quot; para gerar o PDF fiel ao modelo Word.
        </p>
      ) : null}

      {!pdfReady && !legacyHtmlOnly ? (
        <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          PDF não gerado. Verifique se o Gotenberg está ativo (porta 3006) e clique em Regenerar proposta.
        </p>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-md px-2 py-0.5 text-xs font-medium',
            proposal.status === 'draft' && 'bg-warning/15 text-warning',
            proposal.status === 'pdf_ready' && 'bg-primary/10 text-primary',
            proposal.status === 'sent' && 'bg-primary/10 text-primary',
            proposal.status === 'accepted' && 'bg-success/15 text-success',
          )}
        >
          {statusLabel}
        </span>
        <span className="text-xs text-muted-foreground">
          Criada em {formatRelativeDate(proposal.created_at)}
          {proposal.template_version ? ` · Modelo v${proposal.template_version}` : ''}
          {proposal.pdf_generated_at ? ` · PDF em ${formatRelativeDate(proposal.pdf_generated_at)}` : ''}
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_280px]">
        <section className="min-h-[520px] rounded-lg border border-border bg-muted/20">
          {pdfPreviewUrl ? (
            <iframe
              title="Preview da proposta"
              src={pdfPreviewUrl}
              className="h-[min(70vh,720px)] w-full rounded-lg"
            />
          ) : (
            <div className="flex h-[min(50vh,400px)] items-center justify-center p-8 text-center text-sm text-muted-foreground">
              {pdfReady
                ? 'Carregando preview do PDF…'
                : 'Nenhum PDF disponível. Regenerar proposta após conferir a viabilidade.'}
            </div>
          )}
        </section>

        <aside className="space-y-4">
          {summaryRows.length > 0 ? (
            <div className="rounded-lg border border-border bg-surface p-3 text-sm">
              <h3 className="mb-2 font-semibold">Valores no documento</h3>
              <dl className="space-y-1.5 text-xs">
                {summaryRows.map(([label, value]) => (
                  <div key={label} className="flex justify-between gap-2">
                    <dt className="text-muted-foreground">{label}</dt>
                    <dd className="text-right font-medium">{value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <label className="block text-sm">
            <span className="font-medium">Observações comerciais</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Não alteram o layout do PDF — apenas registro interno.
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              className="mt-2 w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={() => void handleSaveNotes()}
            disabled={saveNotes.isPending}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <Save className="h-4 w-4" />
            {saveNotes.isPending ? 'Salvando…' : 'Salvar observações'}
          </button>
        </aside>
      </div>

      <footer className="mt-4 flex flex-wrap gap-2 border-t border-border pt-4">
        {pdfReady ? (
          <button
            type="button"
            onClick={() => void downloadProposalPdf(proposal.id)}
            className={buttonVariants()}
          >
            <Download className="h-4 w-4" />
            Baixar PDF
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleRegenerate()}
          disabled={regenerate.isPending}
          className={buttonVariants()}
        >
          <RefreshCw className="h-4 w-4" />
          {regenerate.isPending ? 'Regenerando…' : 'Regenerar proposta'}
        </button>
        {proposal.has_docx || pdfReady ? (
          <button
            type="button"
            onClick={() => void downloadProposalDocx(proposal.id)}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            <FileText className="h-4 w-4" />
            Baixar DOCX
          </button>
        ) : null}
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={proposal.status === 'sent' || proposal.status === 'accepted' || sendProposal.isPending}
          className={buttonVariants({ variant: 'outline', size: 'sm' })}
        >
          <MessageCircle className="h-4 w-4" />
          {proposal.status === 'sent' ? 'Enviada' : 'Marcar como enviada'}
        </button>
      </footer>
    </div>
  );
}

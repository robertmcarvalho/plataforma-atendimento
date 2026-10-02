'use client';

import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Copy, Loader2, Send } from 'lucide-react';
import { Drawer } from '@/components/ui/Drawer';
import { Button } from '@/components/ui/button';
import { BillingPayslipView } from '@/components/billing/BillingPayslipView';
import {
  fetchDriverPayslip,
  fetchDriverPayslipPdf,
  revokeDriverPayslip,
  sendDriverPayslip,
  type PayslipSendResult,
} from '@/lib/billing/billingApi';
import { apiErrorMessage } from '@/lib/apiErrorMessage';
import { fmtDate } from '@/lib/billing/billingFormat';
import { useAuth } from '@/store/auth';
import { canManageBillingFinancial } from '@/lib/billing/billingFinancialAuth';

export function BillingPayslipDrawer({
  payableId,
  onClose,
}: {
  payableId: string | null;
  onClose: () => void;
}) {
  const [sendResult, setSendResult] = useState<PayslipSendResult | null>(null);
  const [copied, setCopied] = useState(false);
  const user = useAuth((s) => s.user);
  const canManage = canManageBillingFinancial(user?.role, user?.permissions);

  const query = useQuery({
    queryKey: ['billing', 'payslip', payableId],
    queryFn: () => fetchDriverPayslip(payableId!),
    enabled: Boolean(payableId),
  });

  const sendMut = useMutation({
    mutationFn: () => sendDriverPayslip(payableId!),
    onSuccess: (res) => setSendResult(res),
  });

  const revokeMut = useMutation({
    mutationFn: () => revokeDriverPayslip(payableId!),
    onSuccess: () => {
      setSendResult(null);
      query.refetch();
    },
  });

  const pdfMut = useMutation({
    mutationFn: async () => {
      const blob = await fetchDriverPayslipPdf(payableId!);
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  });

  const payslip = sendResult?.payslip || query.data || null;
  const publicUrl = sendResult?.public_url || payslip?.send.public_url || null;

  const copyLink = async () => {
    if (!publicUrl) return;
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <Drawer
      open={Boolean(payableId)}
      onClose={() => {
        setSendResult(null);
        onClose();
      }}
      title={payslip?.driver.name || 'Acerto'}
      subtitle={
        payslip
          ? `${payslip.cycle.label || 'Ciclo'} · ${fmtDate(payslip.cycle.apuracao_start)} a ${fmtDate(payslip.cycle.apuracao_end)}`
          : 'Detalhamento do acerto do entregador'
      }
      eyebrow="Detalhamento do acerto"
      widthClassName="max-w-[min(100vw,480px)]"
      closeIconOnly
      shellClassName="bg-card"
      footer={
        payslip ? (
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button size="sm" variant="outline" onClick={() => pdfMut.mutate()} disabled={pdfMut.isPending}>
              {pdfMut.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
              Ver PDF
            </Button>
            {publicUrl ? (
              <Button size="sm" variant="outline" onClick={copyLink}>
                <Copy className="mr-1 h-3.5 w-3.5" />
                {copied ? 'Copiado' : 'Copiar link'}
              </Button>
            ) : null}
            {canManage && publicUrl ? (
              <Button size="sm" variant="outline" onClick={() => revokeMut.mutate()} disabled={revokeMut.isPending}>
                Revogar link
              </Button>
            ) : null}
            {canManage ? (
              <Button size="sm" onClick={() => sendMut.mutate()} disabled={sendMut.isPending}>
                {sendMut.isPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Send className="mr-1 h-3.5 w-3.5" />}
                Enviar recibo
              </Button>
            ) : null}
          </div>
        ) : null
      }
    >
      {query.isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : query.error || !payslip ? (
        <p className="text-sm text-destructive">
          {apiErrorMessage(query.error, 'Não foi possível carregar o detalhamento deste acerto.')}
        </p>
      ) : (
        <div className="space-y-4">
          {!payslip.send.can_send ? (
            <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              Entregador sem telefone no cadastro. É possível gerar o link e copiar; o WhatsApp não será enviado.
            </p>
          ) : null}
          {sendMut.error ? (
            <p className="text-xs text-destructive">{apiErrorMessage(sendMut.error, 'Falha ao enviar.')}</p>
          ) : null}
          {sendResult ? (
            <p className="rounded-md border border-border bg-background/50 px-3 py-2 text-xs">
              {sendResult.whatsapp_sent
                ? 'WhatsApp enviado com o link do recibo (PDF na página, não no chat).'
                : sendResult.whatsapp_skipped_reason || 'Link gerado.'}{' '}
              Expira em {sendResult.expires_at ? fmtDate(sendResult.expires_at) : '7 dias'}.
            </p>
          ) : null}
          <BillingPayslipView payslip={payslip} />
        </div>
      )}
    </Drawer>
  );
}

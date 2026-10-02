/**
 * Corpo HTML/texto do e-mail do pacote da fatura (sem deps de DB/SMTP).
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildInvoicePackageEmailBody(params: {
  pharmacyName: string;
  cycleLabel: string | null;
  invoiceHtmlUrl: string;
  entityLabel: string;
}): { subject: string; html: string; text: string } {
  const subject = `Faturamento ${params.entityLabel} — ${params.pharmacyName}${
    params.cycleLabel ? ` (${params.cycleLabel})` : ''
  }`;
  const text = [
    `Olá,`,
    '',
    `Segue o pacote de faturamento de ${params.pharmacyName}${
      params.cycleLabel ? ` — ciclo ${params.cycleLabel}` : ''
    }.`,
    '',
    `Relatório da fatura (HTML): ${params.invoiceHtmlUrl}`,
    '',
    'Anexos: boleto (PDF), DANFSe (PDF) e XML da NFS-e.',
    '',
    'Equipe Flux Farma',
  ].join('\n');
  const html = `
    <p>Olá,</p>
    <p>Segue o pacote de faturamento de <strong>${escapeHtml(params.pharmacyName)}</strong>${
      params.cycleLabel ? ` — ciclo <strong>${escapeHtml(params.cycleLabel)}</strong>` : ''
    }.</p>
    <p style="margin:20px 0">
      <a href="${escapeHtml(params.invoiceHtmlUrl)}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:6px;font-weight:600">Abrir fatura (HTML)</a>
    </p>
    <p style="color:#444;font-size:13px">Anexos deste e-mail: <strong>boleto (PDF)</strong>, <strong>DANFSe (PDF)</strong> e <strong>XML da NFS-e</strong>.</p>
    <p style="color:#666;font-size:12px">Se o botão não funcionar, copie e cole:<br/><a href="${escapeHtml(params.invoiceHtmlUrl)}">${escapeHtml(params.invoiceHtmlUrl)}</a></p>
    <p style="color:#888;font-size:12px;margin-top:24px">Equipe Flux Farma</p>
  `;
  return { subject, html, text };
}

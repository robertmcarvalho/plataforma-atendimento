const DEFAULT_GOTENBERG_URL = 'http://localhost:3006';

export class ProposalPdfConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProposalPdfConversionError';
  }
}

function gotenbergBaseUrl(): string {
  return (process.env.GOTENBERG_URL || DEFAULT_GOTENBERG_URL).replace(/\/$/, '');
}

/** Converte DOCX preenchido em PDF via Gotenberg (LibreOffice). */
export async function convertProposalDocxToPdf(docx: Buffer): Promise<Buffer> {
  const url = `${gotenbergBaseUrl()}/forms/libreoffice/convert`;
  const form = new FormData();
  const blob = new Blob([docx], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
  form.append('files', blob, 'proposta.docx');

  let res: Response;
  try {
    res = await fetch(url, { method: 'POST', body: form });
  } catch (e) {
    const hint =
      'Inicie o Gotenberg (docker compose up gotenberg -d ou npm run gotenberg:up). ' +
      `URL: ${gotenbergBaseUrl()}`;
    throw new ProposalPdfConversionError(
      `${hint} — ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new ProposalPdfConversionError(
      `Gotenberg retornou ${res.status}: ${body.slice(0, 500)}`,
    );
  }

  return Buffer.from(await res.arrayBuffer());
}

export async function isGotenbergAvailable(): Promise<boolean> {
  try {
    const res = await fetch(`${gotenbergBaseUrl()}/health`, { method: 'GET' });
    return res.ok;
  } catch {
    return false;
  }
}

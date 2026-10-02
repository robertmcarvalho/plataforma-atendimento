import type { DriverPayslip } from '@/lib/billing/billingApi';
import { BillingPayslipPublicView } from '@/components/billing/BillingPayslipPublicView';

type Payload = { payslip: DriverPayslip };

async function loadPayslip(token: string): Promise<Payload | null> {
  try {
    const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
    const res = await fetch(`${base}/api/public/billing/payslip/${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as Payload;
  } catch {
    return null;
  }
}

export default async function PublicReciboPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await loadPayslip(token);
  const base = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const pdfHrefBase = `${base}/api/public/billing/payslip/${encodeURIComponent(token)}/pdf`;

  if (!data?.payslip) {
    return (
      <main className="min-h-screen bg-[#0a0a0a] px-4 py-16 font-sans text-white">
        <article className="mx-auto max-w-lg rounded-2xl border border-white/10 bg-[#141414] p-6 text-center">
          <h1 className="text-lg font-semibold">Link inválido ou expirado</h1>
          <p className="mt-2 text-sm text-white/55">
            O recibo expira em 7 dias ou pode ter sido revogado. Peça um novo envio ao financeiro.
          </p>
        </article>
      </main>
    );
  }

  return <BillingPayslipPublicView payslip={data.payslip} pdfHrefBase={pdfHrefBase} />;
}

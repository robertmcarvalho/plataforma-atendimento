import { redirect } from 'next/navigation';

export default async function PublicHoleriteRedirectPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  redirect(`/public/recibo/${encodeURIComponent(token)}`);
}

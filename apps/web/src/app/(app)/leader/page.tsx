import type { Metadata } from 'next';
import LeaderPortalClient from './LeaderPortalClient';

export const metadata: Metadata = {
  title: 'Portal do Líder',
  description: 'Acompanhamento operacional do líder de entregadores',
};

export default function LeaderPage() {
  return <LeaderPortalClient />;
}

import type { Metadata } from 'next';
import LeaderSupportClient from './LeaderSupportClient';

export const metadata: Metadata = {
  title: 'Suporte ao Líder',
  description: 'Conversas e atendimento do portal do líder',
};

export default function LeaderSupportPage() {
  return <LeaderSupportClient />;
}

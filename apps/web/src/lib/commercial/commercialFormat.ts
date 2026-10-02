import { formatBRL } from '@/lib/brFormat';
import type { CommercialLeadSource, LeadTemperature } from '@/lib/commercial/types';

const SOURCE_LABELS: Record<CommercialLeadSource, string> = {
  manual: 'Manual',
  instagram: 'Instagram',
  indicacao: 'Indicação',
  whatsapp: 'WhatsApp',
  campanha: 'Campanha',
  referral: 'Indicação parceiro',
  other: 'Outro',
};

export function commercialLeadDisplayName(lead: {
  trade_name?: string | null;
  legal_name?: string | null;
  contact_name?: string | null;
}): string {
  const name = String(lead.trade_name ?? lead.legal_name ?? lead.contact_name ?? '').trim();
  return name || 'Lead sem nome';
}

export function commercialSourceLabel(source: CommercialLeadSource) {
  return SOURCE_LABELS[source] ?? source;
}

export function daysInStage(updatedAt: string) {
  const diff = Date.now() - new Date(updatedAt).getTime();
  const days = Math.max(0, Math.floor(diff / 86400000));
  if (days === 0) return 'Hoje';
  if (days === 1) return '1 dia';
  return `${days} dias`;
}

export function formatRelativeDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

export function formatShortDate(iso: string) {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

export function maskCnpj(cnpj?: string) {
  if (!cnpj) return '—';
  const d = cnpj.replace(/\D/g, '');
  if (d.length !== 14) return cnpj;
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.***/${d.slice(8, 12)}-${d.slice(12)}`;
}

const TEMPERATURE_LABELS: Record<LeadTemperature, string> = {
  frio: 'Frio',
  morno: 'Morno',
  quente: 'Quente',
  urgente: 'Urgente',
};

export function leadTemperatureLabel(temp: LeadTemperature) {
  return TEMPERATURE_LABELS[temp];
}

export function leadTemperatureTone(temp: LeadTemperature) {
  switch (temp) {
    case 'urgente':
      return 'bg-destructive/15 text-destructive';
    case 'quente':
      return 'bg-orange-500/15 text-orange-700 dark:text-orange-400';
    case 'morno':
      return 'bg-warning/15 text-warning';
    default:
      return 'bg-muted text-muted-foreground';
  }
}

export function formatDealValueCents(cents?: number | null) {
  if (cents == null || !Number.isFinite(cents)) return '—';
  return formatBRL(cents / 100);
}

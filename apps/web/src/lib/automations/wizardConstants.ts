'use client';

import { Bot, Clock, GitBranch, MessageSquare, Sparkles, Users, Zap } from 'lucide-react';
import type { ModelKey } from '@/lib/automations/wizardTypes';

export const stepsMeta = [
  { n: 1, title: 'Modelo' },
  { n: 2, title: 'Gatilho' },
  { n: 3, title: 'Fluxo' },
  { n: 4, title: 'Detalhes' },
] as const;

export const templates = [
  { id: 'blank', name: 'Em branco', desc: 'Comece do zero', icon: Sparkles, color: 'text-muted-foreground bg-muted' },
  {
    id: 'triagem_perfil',
    name: 'Triagem por perfil',
    desc: 'Identifica contato, ramifica por perfil e cria pré-cadastro',
    icon: Users,
    color: 'text-primary bg-primary/15',
  },
  { id: 'triage_bot', name: 'Triagem com bot', desc: 'Classifica e roteia conversas', icon: Bot, color: 'text-primary bg-primary/15' },
  { id: 'keyword_routing', name: 'Roteamento por palavra-chave', desc: 'Distribui para filas com base no texto', icon: GitBranch, color: 'text-channel-instagram bg-channel-instagram/15' },
  { id: 'out_of_hours', name: 'Fora do horário', desc: 'Auto-resposta noturna e finais de semana', icon: Clock, color: 'text-warning bg-warning/15' },
  { id: 'csat', name: 'Pesquisa CSAT', desc: 'Envio automático após resolução', icon: MessageSquare, color: 'text-channel-whatsapp bg-channel-whatsapp/15' },
  { id: 'sla_escalation', name: 'Escalação por SLA', desc: 'Aciona supervisor quando o SLA estoura', icon: Zap, color: 'text-destructive bg-destructive/15' },
] as const satisfies ReadonlyArray<{
  id: ModelKey;
  name: string;
  desc: string;
  icon: any;
  color: string;
}>;

export const automationRuleTriggers = [
  { id: 'schedule', label: 'Agendamento', desc: 'Recorrência por horário/cron', icon: Clock },
  { id: 'installment_due_weekly', label: 'Desconto semanal', desc: 'Aviso semanal de desconto (seg 08:00)', icon: Clock },
  { id: 'sla_80_alert', label: 'SLA 80% (tickets)', desc: 'Quando o SLA se aproxima do limite', icon: Zap },
  { id: 'sla_escalated', label: 'SLA escalonado (tickets)', desc: 'Quando ocorrer escalonamento de SLA', icon: Zap },
  { id: 'sla_daily_report', label: 'Relatório diário (tickets)', desc: 'Resumo diário de tickets por supervisor', icon: Clock },
  { id: 'csat', label: 'CSAT', desc: 'Pesquisa após conversa resolvida', icon: MessageSquare },
  { id: 'custom', label: 'Personalizado', desc: 'Use um evento customizado do runtime', icon: Sparkles },
] as const;

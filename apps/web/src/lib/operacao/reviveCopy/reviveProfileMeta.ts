import type { LucideIcon } from 'lucide-react';
import { Activity, BarChart3, Headset, Users, Wallet } from 'lucide-react';
import type { OperacaoMode } from '@/lib/operacao/operacaoMode';

export type ReviveOperacaoPerfil =
  | 'atendente_geral'
  | 'atendente_financeiro'
  | 'gestor_financeiro'
  | 'analista_operacional'
  | 'gestor_operacional';

export const revivePerfilMeta: Record<
  ReviveOperacaoPerfil,
  { label: string; eyebrow: string; description: string; icon: LucideIcon }
> = {
  analista_operacional: {
    label: 'Analista Operacional',
    eyebrow: 'Operação',
    description: 'Visão consolidada das farmácias, líderes, entregadores e compliance.',
    icon: Activity,
  },
  atendente_geral: {
    label: 'Atendente · Atendimento Geral',
    eyebrow: 'Operação · Atendimento',
    description: 'Tarefas de cadastro, matrícula e termo de desligamento dos cooperados.',
    icon: Headset,
  },
  atendente_financeiro: {
    label: 'Atendente Financeiro',
    eyebrow: 'Operação · Financeiro',
    description: 'Acertos de desligamento, lançamento de cotas e adiantamentos.',
    icon: Wallet,
  },
  gestor_financeiro: {
    label: 'Gestor Financeiro',
    eyebrow: 'Operação · Gestão Financeira',
    description: 'Indicadores do setor, autorizações e desempenho dos atendentes.',
    icon: BarChart3,
  },
  gestor_operacional: {
    label: 'Gestor Operacional',
    eyebrow: 'Operação · Gestão',
    description: 'Visão consolidada das carteiras dos analistas operacionais.',
    icon: Users,
  },
};

const MODE_TO_PERFIL: Partial<Record<OperacaoMode, ReviveOperacaoPerfil>> = {
  carteira: 'analista_operacional',
  execucao_geral: 'atendente_geral',
  execucao_financeiro: 'atendente_financeiro',
  gestor_financeiro: 'gestor_financeiro',
  gestor_operacional: 'gestor_operacional',
};

export function operacaoModeToRevivePerfil(mode: OperacaoMode): ReviveOperacaoPerfil | null {
  return MODE_TO_PERFIL[mode] ?? null;
}

export function revivePerfilLabel(mode: OperacaoMode): string {
  const perfil = operacaoModeToRevivePerfil(mode);
  if (perfil) return revivePerfilMeta[perfil].label;
  return 'Operação';
}

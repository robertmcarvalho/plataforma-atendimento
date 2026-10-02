'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';
import Link from 'next/link';
import api from '@/lib/api';
import { Switch } from '@/components/ui/Switch';

const LABELS: { key: string; label: string; desc: string }[] = [
  {
    key: 'conversation_assigned',
    label: 'Nova conversa atribuída',
    desc: 'Quando uma conversa for atribuída a você',
  },
  {
    key: 'mention_internal_note',
    label: 'Menção em nota interna',
    desc: 'Quando alguém te marcar com @',
  },
  {
    key: 'sla_warning',
    label: 'SLA prestes a vencer',
    desc: 'Alertas de prazo na plataforma (painel Operação)',
  },
  {
    key: 'open_tasks_inbox',
    label: 'Pendências na caixa de entrada',
    desc: 'Lista de pendências e alertas no sino da inbox',
  },
  {
    key: 'campaign_done',
    label: 'Campanha concluída',
    desc: 'Avisos na plataforma quando campanhas forem tratadas pela automação',
  },
  {
    key: 'overdue_installment',
    label: 'Parcela em atraso',
    desc: 'Alertas financeiros na plataforma quando o fluxo existir',
  },
  {
    key: 'driver_document_expiry_warning',
    label: 'Vencimento de documento (30/7 dias)',
    desc: 'CNH ou certificado digital de entregador próximo do vencimento',
  },
  {
    key: 'driver_document_expired',
    label: 'Documento vencido',
    desc: 'CNH ou certificado digital de entregador já vencido',
  },
  {
    key: 'driver_signature_pending',
    label: 'Assinatura pendente (Autentique)',
    desc: 'Documento detectado no Autentique aguardando assinatura do entregador',
  },
  {
    key: 'driver_signature_viewed',
    label: 'Documento visualizado (Autentique)',
    desc: 'Entregador abriu o documento no Autentique',
  },
  {
    key: 'driver_signature_signed',
    label: 'Assinatura concluída (Autentique)',
    desc: 'Entregador assinou matrícula ou termo de desligamento',
  },
  {
    key: 'driver_signature_rejected',
    label: 'Assinatura recusada (Autentique)',
    desc: 'Entregador recusou assinar no Autentique',
  },
  {
    key: 'driver_signature_overdue',
    label: 'Prazo de assinatura estourado',
    desc: 'Prazo configurado para assinatura foi ultrapassado',
  },
];

function mergeFromApi(raw: Record<string, unknown> | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  const defaultFor = (key: string) => (key === 'campaign_done' ? false : true);

  for (const row of LABELS) {
    const v = raw?.[row.key];
    if (typeof v === 'boolean') {
      out[row.key] = v;
    } else if (v && typeof v === 'object' && !Array.isArray(v)) {
      const o = v as Record<string, unknown>;
      out[row.key] = typeof o.in_app === 'boolean' ? o.in_app : defaultFor(row.key);
    } else {
      out[row.key] = defaultFor(row.key);
    }
  }
  return out;
}

export function SettingsNotificationsPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['notification-preferences'],
    queryFn: async () => (await api.get<Record<string, unknown>>('/api/users/me/notification-preferences')).data,
  });

  const merged = useMemo(() => mergeFromApi(data), [data]);

  const saveMut = useMutation({
    mutationFn: async (patch: Record<string, boolean>) => {
      await api.patch('/api/users/me/notification-preferences', patch);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['notification-preferences'] });
    },
  });

  const toggle = (key: string) => {
    const nextVal = !merged[key];
    saveMut.mutate({ [key]: nextVal });
  };

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando preferências…</p>;
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">
        Notificações apenas na plataforma (sem e-mail). O painel de atividade na inbox segue estas opções.
      </p>
      <p className="mt-2 text-[11px] text-muted-foreground">
        <Link href="/inbox" className="text-primary hover:underline">
          Abrir inbox
        </Link>
      </p>
      <div className="mt-4 space-y-4">
        {LABELS.map((n) => (
          <div
            key={n.key}
            className="flex items-center justify-between border-b border-border/50 pb-4 last:border-0 last:pb-0"
          >
            <div>
              <div className="text-sm font-medium text-foreground">{n.label}</div>
              <div className="text-[11px] text-muted-foreground">{n.desc}</div>
            </div>
            <Switch
              checked={merged[n.key]}
              disabled={saveMut.isPending}
              onCheckedChange={() => toggle(n.key)}
              aria-label={n.label}
            />
          </div>
        ))}
      </div>
      {saveMut.isError ? (
        <p className="mt-2 text-xs text-destructive">
          Não foi possível salvar. Confirme a migration 011 (notification_preferences).
        </p>
      ) : null}
    </div>
  );
}

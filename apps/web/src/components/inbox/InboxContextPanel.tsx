'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CheckCheck, Clock, X } from 'lucide-react';
import { ExternalAppLink } from '@/components/navigation/ExternalAppLink';
import { InboxAttendanceSlaStages } from '@/components/inbox/InboxAttendanceSlaStages';
import { InboxDriverVinculoSection } from '@/components/inbox/InboxDriverVinculoSection';
import { InboxTicketingSidecar } from '@/features/ticketing/_wip/InboxTicketingSidecar';
import { ProfileTypeBadge } from '@/components/ui/ProfileTypeBadge';
import { Button } from '@/components/ui/button';
import { initials } from '@/lib/inbox/inboxFormatters';
import { INBOX_COLUMN_HEADER_CLASS } from '@/lib/inbox/inboxColumnHeader';
import type {
  ApiContactConversation,
  ApiConversationDetail,
  ApiConversationPriority,
  ApiConversationTagCatalogRow,
  UiConversation,
} from '@/lib/inbox/types';
import { catalogToneToPill } from '@/lib/interactiveRow';
import { features } from '@/lib/features';
import { cn } from '@/lib/utils';
import type { ContactDetail } from '@/types/contact';

export type InboxContextPanelProps = {
  displayName: string;
  contactId: string | null;
  contact?: ContactDetail;
  cadastroHref: string | null;
  onOpenProfile: () => void;
  onOpenHistory: () => void;
  showSaveToContacts: boolean;
  saveContactBusy: boolean;
  isDetailLoading: boolean;
  saveContactHint: string | null;
  saveContactDuplicateId: string | null;
  onSaveContact: () => void;
  onLinkExistingContact: () => void;
  detail?: ApiConversationDetail;
  active: UiConversation | null;
  activeId: string;
  priorityOpen: boolean;
  onTogglePriorityOpen: () => void;
  priorityMenuRef: React.RefObject<HTMLDivElement | null>;
  priorityLabel: string;
  priorityUi: { pill: string; sla: string };
  currentPriority: ApiConversationPriority;
  onSetPriority: (priority: ApiConversationPriority) => void;
  slaCountdown: string;
  nowTick: number;
  tagPickerRef: React.RefObject<HTMLDivElement | null>;
  tagPickerOpen: boolean;
  onToggleTagPicker: () => void;
  canEditConversationTags: boolean;
  conversationTagCatalog: ApiConversationTagCatalogRow[];
  tagLabelBySlug: Map<string, string>;
  tagToneBySlug: Map<string, string>;
  onAddTag: (slug: string) => void;
  onRemoveTag: (slug: string) => void;
  isSending: boolean;
  isUploading: boolean;
  isRecording: boolean;
  previousConversations?: ApiContactConversation[];
  /** Painel em sheet no mobile (sem `hidden lg:flex`). */
  mobile?: boolean;
};

export function InboxContextPanel({
  displayName,
  contactId,
  contact,
  cadastroHref,
  onOpenProfile,
  onOpenHistory,
  showSaveToContacts,
  saveContactBusy,
  isDetailLoading,
  saveContactHint,
  saveContactDuplicateId,
  onSaveContact,
  onLinkExistingContact,
  detail,
  active,
  activeId,
  priorityOpen,
  onTogglePriorityOpen,
  priorityMenuRef,
  priorityLabel,
  priorityUi,
  currentPriority,
  onSetPriority,
  slaCountdown,
  nowTick,
  tagPickerRef,
  tagPickerOpen,
  onToggleTagPicker,
  canEditConversationTags,
  conversationTagCatalog,
  tagLabelBySlug,
  tagToneBySlug,
  onAddTag,
  onRemoveTag,
  isSending,
  isUploading,
  isRecording,
  previousConversations,
  mobile = false,
}: InboxContextPanelProps) {
  const appliedTags = (detail?.tags || active?.raw.tags || []) as string[];

  return (
    <aside
      className={cn(
        'flex min-h-0 min-w-0 flex-col overflow-hidden bg-surface',
        !mobile && 'hidden lg:flex'
      )}
      aria-labelledby="inbox-context-drawer-title"
    >
      <div className={INBOX_COLUMN_HEADER_CLASS}>
        <span id="inbox-context-drawer-title" className="text-sm font-semibold text-foreground">
          Contexto
        </span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        <div className="flex flex-col items-center border-b border-border px-4 py-5">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp to-success text-base font-semibold">
            {initials(displayName)}
          </div>
          <div className="mt-3 flex flex-col items-center gap-1.5">
            <span className="text-sm font-semibold">{displayName}</span>
            {contactId ? <ProfileTypeBadge type={contact?.profile_type} /> : null}
          </div>
          <div className="mt-0.5 inbox-t-control text-muted-foreground">—</div>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Button
              variant="outline"
              size="xs"
              onClick={onOpenProfile}
              disabled={!cadastroHref && !contactId}
              title={cadastroHref ? 'Abrir ficha de cadastro (nova aba)' : 'Ver perfil do contato'}
            >
              Perfil
            </Button>
            <Button variant="outline" size="xs" onClick={onOpenHistory} disabled={!activeId} title="Ver histórico">
              Histórico
            </Button>
            {showSaveToContacts ? (
              <button
                type="button"
                onClick={() => void onSaveContact()}
                disabled={saveContactBusy || isDetailLoading}
                className="rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/15 transition-colors disabled:opacity-50"
                title="Criar registro em Contatos e vincular a esta conversa"
              >
                {saveContactBusy ? 'Salvando…' : 'Salvar nos contatos'}
              </button>
            ) : null}
          </div>
          {saveContactHint ? (
            <p className="mt-2 max-w-[14rem] text-center inbox-t-control text-muted-foreground">{saveContactHint}</p>
          ) : null}
          {saveContactDuplicateId ? (
            <div className="mt-2 flex flex-col items-center gap-1.5 inbox-t-control">
              <button
                type="button"
                onClick={() => void onLinkExistingContact()}
                disabled={saveContactBusy}
                className="text-xs font-medium text-primary underline-offset-2 hover:underline disabled:opacity-50"
              >
                Vincular conversa ao contato existente
              </button>
              <ExternalAppLink href="/contacts" className="text-muted-foreground underline-offset-2 hover:underline">
                Ir para Contatos
              </ExternalAppLink>
            </div>
          ) : null}
        </div>

        <InboxDriverVinculoSection detail={detail} contact={contact} />

        <div className="border-b border-border px-4 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground mb-3">Atribuição</h4>
          <div className="space-y-2.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Agente</span>
              <span className="font-medium">{detail?.attendant?.name || 'Sem dono'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Equipe</span>
              <span className="font-medium">{detail?.sectors?.name || active?.raw.sectors?.name || '—'}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground">Prioridade</span>
              <div className="relative">
                <button
                  type="button"
                  onClick={onTogglePriorityOpen}
                  disabled={!activeId || isSending}
                  className={cn(
                    'rounded px-1.5 py-0.5 inbox-t-meta font-medium transition-colors hover:bg-sidebar-accent/60 disabled:opacity-60',
                    priorityUi.pill
                  )}
                  title="Definir prioridade"
                  aria-expanded={priorityOpen}
                >
                  {priorityLabel}
                </button>
                {priorityOpen ? (
                  <div
                    ref={priorityMenuRef}
                    className="absolute right-0 top-7 z-[60] w-36 rounded-xl border border-border bg-popover p-1 shadow-md"
                  >
                    {(
                      [
                        { key: 'low' as const, label: 'Baixa' },
                        { key: 'normal' as const, label: 'Normal' },
                        { key: 'high' as const, label: 'Alta' },
                        { key: 'urgent' as const, label: 'Urgente' },
                      ] as const
                    ).map((p) => (
                      <button
                        key={p.key}
                        type="button"
                        onClick={() => void onSetPriority(p.key)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-lg px-3 py-2 text-xs hover:bg-sidebar-accent/60',
                          currentPriority === p.key ? 'text-foreground' : 'text-muted-foreground'
                        )}
                      >
                        <span>{p.label}</span>
                        {currentPriority === p.key ? <span className="font-mono inbox-t-meta text-primary">✓</span> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground flex items-center gap-1">
                <Clock className="h-3 w-3" />
                SLA
              </span>
              <span className={cn('font-mono', priorityUi.sla)}>{slaCountdown}</span>
            </div>
          </div>
        </div>

        <div className="border-b border-border px-4 py-4">
          <h4 className="mb-3 text-xs font-semibold uppercase tracking-wider text-subtle-foreground">SLAs por etapa</h4>
          <InboxAttendanceSlaStages detail={detail} nowMs={nowTick} />
        </div>

        {features.ticketingPanel ? <InboxTicketingSidecar conversationId={activeId || null} detail={detail} /> : null}

        <div className="border-b border-border px-4 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground mb-3">Tags</h4>
          <div ref={tagPickerRef} className="relative flex flex-wrap items-center gap-1.5">
            {appliedTags.map((t) => {
              const label = tagLabelBySlug.get(t) || t;
              return (
                <span
                  key={t}
                  className={cn('inline-flex max-w-full items-center gap-1 inbox-t-meta', catalogToneToPill(tagToneBySlug.get(t)))}
                >
                  <span className="truncate">{label}</span>
                  {canEditConversationTags ? (
                    <button
                      type="button"
                      onClick={() => void onRemoveTag(t)}
                      disabled={!activeId || isSending || isUploading || isRecording}
                      className="shrink-0 rounded p-0.5 text-muted-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground disabled:opacity-40"
                      title="Remover tag"
                      aria-label={`Remover tag ${label}`}
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  ) : null}
                </span>
              );
            })}
            {canEditConversationTags ? (
              <>
                <button
                  type="button"
                  onClick={onToggleTagPicker}
                  disabled={!activeId || isSending || isUploading || isRecording}
                  className="rounded border border-dashed border-border px-2 py-0.5 inbox-t-meta text-subtle-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:pointer-events-none"
                  title="Adicionar tag"
                >
                  + adicionar
                </button>
                {tagPickerOpen ? (
                  <div className="absolute left-0 top-full z-[60] mt-1 max-h-52 w-[min(100%,18rem)] overflow-y-auto rounded-xl border border-border bg-popover p-1 shadow-md">
                    {conversationTagCatalog.filter((row) => !appliedTags.includes(row.slug)).length === 0 ? (
                      <p className="px-2 py-2 inbox-t-meta text-muted-foreground">Todas as tags do catálogo já foram aplicadas.</p>
                    ) : (
                      conversationTagCatalog
                        .filter((row) => !appliedTags.includes(row.slug))
                        .map((row) => (
                          <button
                            key={row.slug}
                            type="button"
                            onClick={() => void onAddTag(row.slug)}
                            disabled={!activeId || isSending}
                            className="flex w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-sidebar-accent/60 disabled:opacity-50"
                          >
                            {row.label_pt}
                          </button>
                        ))
                    )}
                  </div>
                ) : null}
              </>
            ) : null}
          </div>
        </div>

        <div className="px-4 py-4">
          <h4 className="text-xs font-semibold uppercase tracking-wider text-subtle-foreground mb-3">Conversas anteriores</h4>
          <div className="space-y-2">
            {previousConversations && previousConversations.length > 0 ? (
              previousConversations.map((h) => {
                const topic = (h.summary || h.close_reason || 'Conversa').trim();
                const dateIso = h.resolved_at || h.last_message_at || h.opened_at;
                const dateLabel = dateIso ? format(new Date(dateIso), 'dd MMM', { locale: ptBR }) : '—';
                return (
                  <div key={h.id} className="rounded-md border border-border bg-background/40 px-2.5 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium truncate">{topic}</span>
                      <span className="shrink-0 font-mono inbox-t-meta text-subtle-foreground">{dateLabel}</span>
                    </div>
                    <div className="mt-1 flex items-center gap-1 inbox-t-meta text-success">
                      <CheckCheck className="h-2.5 w-2.5" />
                      {h.status === 'closed' ? 'Fechado' : 'Resolvido'}
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-xs text-muted-foreground">Nenhuma conversa anterior.</div>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}

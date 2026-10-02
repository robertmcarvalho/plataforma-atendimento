'use client';

import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { ChevronLeft, MoreHorizontal, PanelRight, Phone, Sparkles, Star, Video } from 'lucide-react';
import { InboxAdvanceDecisionBar } from '@/components/inbox/InboxAdvanceDecisionBar';
import { SentimentBadge } from '@/components/inbox/ai/SentimentBadge';
import { UrgencyDot } from '@/components/inbox/ai/UrgencyBadge';
import { ChannelBadge } from '@/components/ui/ChannelBadge';
import { MessageBubble } from '@/components/ui/MessageBubble';
import { ProfileTypeBadge } from '@/components/ui/ProfileTypeBadge';
import { StatusDot } from '@/components/ui/StatusDot';
import { Button } from '@/components/ui/button';
import { initials } from '@/lib/inbox/inboxFormatters';
import { INBOX_COLUMN_HEADER_CLASS } from '@/lib/inbox/inboxColumnHeader';
import type { ApiConversationStatus, ApiMessage, ThreadItem, UiConversation } from '@/lib/inbox/types';
import { features } from '@/lib/features';
import { cn } from '@/lib/utils';
import type { ContactDetail } from '@/types/contact';

type AdvanceTask = {
  id: string;
  title?: string;
  description?: string | null;
  phase?: string;
  metadata?: Record<string, unknown>;
};

export type ConversationDetailProps = {
  active: UiConversation | null;
  activeId: string;
  displayName: string;
  displayPhone: string;
  clientSince: string;
  contactId: string | null;
  contact?: ContactDetail;
  isFav: boolean;
  currentStatus: ApiConversationStatus;
  isDetailLoading: boolean;
  isDetailError: boolean;
  onRefetchDetail: () => void;
  threadItems: ThreadItem[];
  messageById: Map<string, ApiMessage>;
  chatHeaderAi: { sentiment: string | null; urgency: string | null };
  aiSentimentEnabled: boolean;
  aiUrgencyEnabled: boolean;
  isSending: boolean;
  isUploading: boolean;
  isRecording: boolean;
  copilotOpen: boolean;
  onToggleCopilot: () => void;
  onToggleFavorite: () => void;
  onResolve: () => void;
  moreOpen: boolean;
  onToggleMore: () => void;
  moreMenuRef: React.RefObject<HTMLDivElement | null>;
  onAssignToMe: () => void;
  onReopen: () => void;
  canEditConversationTags: boolean;
  onOpenTagPicker: () => void;
  onOpenNote: () => void;
  onOpenTransfer: () => void;
  onOpenHistory: () => void;
  canDecideAdvance: boolean;
  conversationAdvanceTask?: AdvanceTask | null;
  advanceDecideBusy: boolean;
  onRejectAdvance: (taskId: string) => void;
  onApproveAdvance: (taskId: string) => void;
  onOpenAdvanceEntry: (taskId: string) => void;
  composer: React.ReactNode;
  onBack?: () => void;
  onOpenContext?: () => void;
};

export function ConversationDetail({
  active,
  activeId,
  displayName,
  displayPhone,
  clientSince,
  contactId,
  contact,
  isFav,
  currentStatus,
  isDetailLoading,
  isDetailError,
  onRefetchDetail,
  threadItems,
  messageById,
  chatHeaderAi,
  aiSentimentEnabled,
  aiUrgencyEnabled,
  isSending,
  isUploading,
  isRecording,
  copilotOpen,
  onToggleCopilot,
  onToggleFavorite,
  onResolve,
  moreOpen,
  onToggleMore,
  moreMenuRef,
  onAssignToMe,
  onReopen,
  canEditConversationTags,
  onOpenTagPicker,
  onOpenNote,
  onOpenTransfer,
  onOpenHistory,
  canDecideAdvance,
  conversationAdvanceTask,
  advanceDecideBusy,
  onRejectAdvance,
  onApproveAdvance,
  onOpenAdvanceEntry,
  composer,
  onBack,
  onOpenContext,
}: ConversationDetailProps) {
  const actionDisabled = !activeId || isSending || isUploading || isRecording;

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-r border-border bg-background">
      <div className={INBOX_COLUMN_HEADER_CLASS}>
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {onBack ? (
            <Button type="button" variant="ghost" size="icon-sm" onClick={onBack} aria-label="Voltar para conversas">
              <ChevronLeft className="h-5 w-5" />
            </Button>
          ) : null}
          <div className="relative shrink-0">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-channel-whatsapp to-success text-xs font-semibold text-foreground">
              {initials(displayName)}
            </div>
            <StatusDot status={active?.status || 'offline'} pulse className="absolute -bottom-0.5 -right-0.5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="truncate text-sm font-semibold tracking-tight">{displayName}</h3>
              {contactId ? <ProfileTypeBadge type={contact?.profile_type} /> : null}
              <ChannelBadge channel={active?.channel || 'whatsapp'} />
            </div>
            <div className="flex items-center gap-2 truncate inbox-t-meta text-muted-foreground">
              <span className="truncate">{displayPhone || '—'}</span>
              <span className="text-subtle-foreground">·</span>
              <span className="hidden truncate sm:inline">Cliente desde {clientSince}</span>
              {features.aiAnalysisBadges && aiSentimentEnabled && chatHeaderAi.sentiment ? (
                <SentimentBadge sentiment={chatHeaderAi.sentiment} className="h-4 w-4" />
              ) : null}
              {features.aiAnalysisBadges && aiUrgencyEnabled && chatHeaderAi.urgency ? (
                <UrgencyDot urgency={chatHeaderAi.urgency} />
              ) : null}
            </div>
          </div>
        </div>
        <div className="relative flex shrink-0 items-center gap-1">
            {onOpenContext ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onOpenContext}
                className="text-muted-foreground lg:hidden"
                title="Contexto do contato"
              >
                <PanelRight className="h-4 w-4" />
              </Button>
            ) : null}
            <Button type="button" variant="ghost" size="icon-sm" disabled className="hidden text-muted-foreground sm:inline-flex" title="Em breve">
              <Phone className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" disabled className="text-muted-foreground" title="Em breve">
              <Video className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleFavorite}
              className={cn(isFav ? 'text-primary' : 'text-muted-foreground')}
              title={isFav ? 'Remover favorito' : 'Favoritar'}
              aria-pressed={isFav}
            >
              <Star className="h-4 w-4" fill={isFav ? 'currentColor' : 'none'} />
            </Button>
            <div className="mx-1 h-5 w-px bg-border" />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleCopilot}
              className={cn(copilotOpen ? 'text-primary' : 'text-muted-foreground')}
              title="Copiloto interno"
              aria-expanded={copilotOpen}
            >
              <Sparkles className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void onResolve()}
              disabled={actionDisabled}
              data-testid="inbox-resolve"
            >
              Resolver
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={onToggleMore}
              className="text-muted-foreground"
              title="Ações"
              aria-expanded={moreOpen}
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>

            {moreOpen ? (
              <div
                ref={moreMenuRef}
                className="absolute right-0 top-11 z-40 w-56 rounded-xl border border-border bg-popover p-1 shadow-md"
              >
                <button
                  type="button"
                  onClick={() => {
                    onToggleMore();
                    void onAssignToMe();
                  }}
                  className="flex w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-sidebar-accent/60"
                >
                  Assumir conversa
                </button>

                {currentStatus === 'resolved' ? (
                  <button
                    type="button"
                    onClick={() => {
                      onToggleMore();
                      void onReopen();
                    }}
                    className="flex w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-sidebar-accent/60"
                  >
                    Reabrir
                  </button>
                ) : null}

                {canEditConversationTags ? (
                  <button
                    type="button"
                    onClick={() => {
                      onToggleMore();
                      onOpenTagPicker();
                    }}
                    className="flex w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-sidebar-accent/60"
                  >
                    Adicionar tag
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={() => {
                    onToggleMore();
                    onOpenNote();
                  }}
                  className="flex w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-sidebar-accent/60"
                >
                  Nota interna
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onToggleMore();
                    onOpenTransfer();
                  }}
                  className="flex w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-sidebar-accent/60"
                >
                  Transferir
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onToggleMore();
                    onOpenHistory();
                  }}
                  className="flex w-full rounded-lg px-3 py-2 text-left text-xs text-foreground hover:bg-sidebar-accent/60"
                >
                  Histórico
                </button>
              </div>
            ) : null}
        </div>
      </div>

      {canDecideAdvance && conversationAdvanceTask ? (
        <InboxAdvanceDecisionBar
          task={{
            id: conversationAdvanceTask.id,
            title: conversationAdvanceTask.title,
            description: conversationAdvanceTask.description,
            phase: String(conversationAdvanceTask.phase || conversationAdvanceTask.metadata?.phase || 'review'),
          }}
          busy={advanceDecideBusy}
          onReject={() => onRejectAdvance(conversationAdvanceTask.id)}
          onApprove={() => onApproveAdvance(conversationAdvanceTask.id)}
          onOpenEntry={() => onOpenAdvanceEntry(conversationAdvanceTask.id)}
        />
      ) : null}

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto max-w-3xl space-y-4">
          {isDetailLoading ? (
            <div className="text-sm text-muted-foreground">Carregando conversa…</div>
          ) : isDetailError ? (
            <div className="text-sm text-muted-foreground">
              Falha ao carregar a conversa.
              <button type="button" onClick={() => void onRefetchDetail()} className="ml-2 text-primary hover:underline">
                Tentar novamente
              </button>
            </div>
          ) : threadItems.length === 0 ? (
            <div className="text-sm text-muted-foreground">Sem mensagens.</div>
          ) : (
            threadItems.map((m) =>
              m.kind === 'separator' ? (
                <MessageBubble key={m.id} model={{ kind: 'separator', id: m.id, label: m.label }} />
              ) : m.kind === 'note' ? (
                <MessageBubble
                  key={m.id}
                  model={{
                    kind: 'note',
                    id: m.id,
                    content: m.text,
                    created_at: new Date(m.createdAtMs).toISOString(),
                    authorLabel: m.author,
                  }}
                />
              ) : (() => {
                const raw = messageById.get(m.id);
                if (!raw) return null;
                return (
                  <MessageBubble
                    key={m.id}
                    viewerRole="staff"
                    model={{
                      kind: 'message',
                      id: raw.id,
                      direction: raw.direction,
                      type: raw.type,
                      content: raw.content || '',
                      media_url: raw.media_url,
                      created_at: raw.created_at,
                      status: raw.status,
                    }}
                  />
                );
              })()
            )
          )}
        </div>
      </div>

      {composer}
    </div>
  );
}

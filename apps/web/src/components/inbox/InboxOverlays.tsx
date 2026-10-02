'use client';

import type { RefObject } from 'react';
import { ContactProfileModal } from '@/components/inbox/ContactProfileModal';
import { InboxAdvanceEntryDrawer } from '@/components/inbox/InboxAdvanceEntryDrawer';
import { InboxModals } from '@/components/inbox/InboxModals';
import { NewConversationModal } from '@/components/inbox/NewConversationModal';
import type { ApiConversationDetail, ApiSector, ApiUser, MentionCandidate } from '@/lib/inbox/types';
import type { AdvanceEntryPrefill } from '@/components/inbox/InboxAdvanceEntryDrawer';
import type { TemplatePickerOption } from '@/components/inbox/NewConversationModal';

type AdvanceEntryContext = {
  entry_prefill?: AdvanceEntryPrefill;
  advance_context?: { requested_amount?: number; recommended_max_amount?: number };
  task?: { metadata?: Record<string, unknown> };
};

export type InboxOverlaysProps = {
  profileOpen: boolean;
  onCloseProfile: () => void;
  contactId: string | null;
  fallbackPhone?: string;
  fallbackName?: string;
  historyOpen: boolean;
  onCloseHistory: () => void;
  detail?: ApiConversationDetail;
  noteOpen: boolean;
  onCloseNote: () => void;
  noteText: string;
  onNoteTextChange: (value: string) => void;
  noteCaret: number;
  onNoteCaretChange: (pos: number) => void;
  noteTextareaRef: RefObject<HTMLTextAreaElement | null>;
  filteredMentionCandidates: MentionCandidate[];
  noteHint: string | null;
  isSending: boolean;
  onSubmitNote: () => void;
  transferOpen: boolean;
  onCloseTransfer: () => void;
  transferSectorId: string;
  onTransferSectorIdChange: (id: string) => void;
  transferAttendantId: string;
  onTransferAttendantIdChange: (id: string) => void;
  transferReason: string;
  onTransferReasonChange: (reason: string) => void;
  sectors?: ApiSector[];
  users?: ApiUser[];
  onSubmitTransfer: () => void;
  advanceEntryDrawerOpen: boolean;
  advanceEntryTaskId: string | null;
  advanceEntryContext?: AdvanceEntryContext;
  onCloseAdvanceEntry: () => void;
  onAdvanceEntryDone: () => void;
  showNewConversation: boolean;
  onCloseNewConversation: () => void;
  templatesData?: TemplatePickerOption[];
  workspaceChannelId?: string | null;
  onConversationCreated: (id: string) => void;
};

export function InboxOverlays({
  profileOpen,
  onCloseProfile,
  contactId,
  fallbackPhone,
  fallbackName,
  historyOpen,
  onCloseHistory,
  detail,
  noteOpen,
  onCloseNote,
  noteText,
  onNoteTextChange,
  noteCaret,
  onNoteCaretChange,
  noteTextareaRef,
  filteredMentionCandidates,
  noteHint,
  isSending,
  onSubmitNote,
  transferOpen,
  onCloseTransfer,
  transferSectorId,
  onTransferSectorIdChange,
  transferAttendantId,
  onTransferAttendantIdChange,
  transferReason,
  onTransferReasonChange,
  sectors,
  users,
  onSubmitTransfer,
  advanceEntryDrawerOpen,
  advanceEntryTaskId,
  advanceEntryContext,
  onCloseAdvanceEntry,
  onAdvanceEntryDone,
  showNewConversation,
  onCloseNewConversation,
  templatesData,
  workspaceChannelId,
  onConversationCreated,
}: InboxOverlaysProps) {
  return (
    <>
      <ContactProfileModal
        open={profileOpen}
        onClose={onCloseProfile}
        contactId={contactId}
        fallbackPhone={fallbackPhone}
        fallbackName={fallbackName}
      />
      <InboxModals
        historyOpen={historyOpen}
        onCloseHistory={onCloseHistory}
        detail={detail}
        noteOpen={noteOpen}
        onCloseNote={onCloseNote}
        noteText={noteText}
        onNoteTextChange={onNoteTextChange}
        noteCaret={noteCaret}
        onNoteCaretChange={onNoteCaretChange}
        noteTextareaRef={noteTextareaRef}
        filteredMentionCandidates={filteredMentionCandidates}
        noteHint={noteHint}
        isSending={isSending}
        onSubmitNote={onSubmitNote}
        transferOpen={transferOpen}
        onCloseTransfer={onCloseTransfer}
        transferSectorId={transferSectorId}
        onTransferSectorIdChange={onTransferSectorIdChange}
        transferAttendantId={transferAttendantId}
        onTransferAttendantIdChange={onTransferAttendantIdChange}
        transferReason={transferReason}
        onTransferReasonChange={onTransferReasonChange}
        sectors={sectors}
        users={users}
        onSubmitTransfer={onSubmitTransfer}
      />
      {advanceEntryDrawerOpen && advanceEntryTaskId && advanceEntryContext?.entry_prefill ? (
        <InboxAdvanceEntryDrawer
          open={advanceEntryDrawerOpen}
          taskId={advanceEntryTaskId}
          prefill={advanceEntryContext.entry_prefill}
          defaultAmount={
            Number(
              advanceEntryContext.advance_context?.requested_amount ||
                advanceEntryContext.task?.metadata?.amount ||
                advanceEntryContext.advance_context?.recommended_max_amount ||
                0
            ) || undefined
          }
          onClose={onCloseAdvanceEntry}
          onDone={onAdvanceEntryDone}
        />
      ) : null}
      {showNewConversation ? (
        <NewConversationModal
          open={showNewConversation}
          onClose={onCloseNewConversation}
          sectors={(sectors || []).map((s) => ({ id: s.id, name: s.name }))}
          templates={templatesData || []}
          workspaceChannelId={workspaceChannelId}
          onCreated={onConversationCreated}
        />
      ) : null}
    </>
  );
}

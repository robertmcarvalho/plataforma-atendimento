'use client';

import { openAppRouteInNewTab } from '@/lib/openAppRoute';
import { ConversationDetail } from '@/components/inbox/ConversationDetail';
import { ConversationList } from '@/components/inbox/ConversationList';
import { CopilotPanel } from '@/components/copilot/CopilotPanel';
import { InboxContextPanel } from '@/components/inbox/InboxContextPanel';
import { InboxOverlays } from '@/components/inbox/InboxOverlays';
import { MessageComposer } from '@/components/inbox/MessageComposer';
import type { InboxPageController } from '@/lib/inbox/useInboxPageController';

type Props = Pick<
  InboxPageController,
  | 'aiRuntime'
  | 'flags'
  | 'state'
  | 'queries'
  | 'composer'
  | 'derived'
  | 'actions'
  | 'nowTick'
  | 'onAdvanceEntryDone'
  | 'onSubmitNote'
  | 'onRejectAdvance'
  | 'onConversationCreated'
  | 'selectedChannelId'
>;

export function InboxPageListColumn({ flags, state, queries, nowTick, aiRuntime }: Props) {
  const { canStartStaffConversation, isSupervisor } = flags;

  return (
    <ConversationList
      isSupervisor={isSupervisor}
      supervisorMainTab={state.supervisorMainTab}
      onSupervisorMainTabChange={state.setSupervisorMainTab}
      folder={state.folder}
      folders={queries.folders}
      filteredConversations={queries.filteredConversations}
      unreadCount={queries.unreadCount}
      activeId={state.activeId}
      onSelectConversation={state.setActiveId}
      isConvsLoading={queries.isConvsLoading}
      isConvsError={queries.isConvsError}
      onRefreshConversations={() => void queries.refetchConvs()}
      canStartStaffConversation={canStartStaffConversation}
      onNewConversation={() => state.setShowNewConversation(true)}
      supervisorTaskStatus={state.supervisorTaskStatus}
      onSupervisorTaskStatusChange={state.setSupervisorTaskStatus}
      supervisorTaskType={state.supervisorTaskType}
      onSupervisorTaskTypeChange={state.setSupervisorTaskType}
      supervisorTicketStatus={state.supervisorTicketStatus}
      onSupervisorTicketStatusChange={state.setSupervisorTicketStatus}
      supervisorTasksPanel={queries.supervisorTasksPanel}
      supervisorTicketsPanel={queries.supervisorTicketsPanel}
      nowTick={nowTick}
      aiSentimentEnabled={Boolean(aiRuntime.sentiment)}
      aiUrgencyEnabled={Boolean(aiRuntime.urgency)}
    />
  );
}

export function InboxPageDetailColumn({
  flags,
  state,
  queries,
  composer,
  derived,
  actions,
  aiRuntime,
  onRejectAdvance,
  onBack,
  onOpenContext,
}: Props & { onBack?: () => void; onOpenContext?: () => void }) {
  const { canEditConversationTags, canDecideAdvance } = flags;

  return (
    <ConversationDetail
      active={queries.active}
      activeId={state.activeId}
      displayName={derived.displayName}
      displayPhone={derived.displayPhone}
      clientSince={derived.clientSince}
      contactId={queries.contactId}
      contact={queries.contact}
      isFav={derived.isFav}
      currentStatus={derived.currentStatus}
      isDetailLoading={queries.isDetailLoading}
      isDetailError={queries.isDetailError}
      onRefetchDetail={() => void queries.refetchDetail()}
      threadItems={derived.threadItems}
      messageById={derived.messageById}
      chatHeaderAi={derived.chatHeaderAi}
      aiSentimentEnabled={Boolean(aiRuntime.sentiment)}
      aiUrgencyEnabled={Boolean(aiRuntime.urgency)}
      isSending={composer.isSending}
      isUploading={composer.isUploading}
      isRecording={composer.isRecording}
      copilotOpen={state.copilotOpen}
      onToggleCopilot={state.toggleCopilot}
      onToggleFavorite={actions.toggleFavorite}
      onResolve={actions.onResolve}
      moreOpen={state.moreOpen}
      onToggleMore={() => state.setMoreOpen((v) => !v)}
      moreMenuRef={state.moreMenuRef}
      onAssignToMe={actions.assignToMe}
      onReopen={actions.reopen}
      canEditConversationTags={canEditConversationTags}
      onOpenTagPicker={() => state.setTagPickerOpen(true)}
      onOpenNote={() => state.setNoteOpen(true)}
      onOpenTransfer={actions.openTransfer}
      onOpenHistory={() => state.setHistoryOpen(true)}
      canDecideAdvance={canDecideAdvance}
      conversationAdvanceTask={queries.conversationAdvanceTask}
      advanceDecideBusy={actions.advanceDecideBusy}
      onRejectAdvance={onRejectAdvance}
      onApproveAdvance={(taskId) => void actions.decideTask(taskId, 'approved')}
      onOpenAdvanceEntry={state.openAdvanceEntry}
      onBack={onBack}
      onOpenContext={onOpenContext}
      composer={
        <MessageComposer
          activeId={state.activeId}
          composerText={composer.composerText}
          onComposerTextChange={composer.setComposerText}
          sendError={composer.sendError}
          uploadError={composer.uploadError}
          recordingError={composer.recordingError}
          isSending={composer.isSending}
          isUploading={composer.isUploading}
          uploadStatusLabel={composer.uploadStatusLabel}
          isRecording={composer.isRecording}
          recordingSec={composer.recordingSec}
          canEditConversationTags={canEditConversationTags}
          suggestReplyEnabled={Boolean(aiRuntime.suggest_reply)}
          fileInputRef={composer.fileInputRef}
          textareaRef={composer.textareaRef}
          onSend={composer.onSend}
          onFileChange={composer.onFileChange}
          openFilePicker={composer.openFilePicker}
          insertEmoji={composer.insertEmoji}
          stopRecording={composer.stopRecording}
          toggleRecording={composer.toggleRecording}
          onInsertSuggestion={composer.appendToComposer}
          onToggleTagPicker={() => state.setTagPickerOpen((o) => !o)}
          whatsappWindowOpen={derived.whatsappWindowOpen}
          composerMode={composer.composerMode}
          onComposerModeChange={composer.setComposerMode}
          templates={composer.templates}
          templateId={composer.templateId}
          onTemplateIdChange={composer.setTemplateId}
          templateVars={composer.templateVars}
          onTemplateVarsChange={composer.setTemplateVars}
          selectedTemplate={composer.selectedTemplate}
          onSendTemplate={composer.onSendTemplate}
          canSendTemplate={composer.canSendTemplate}
        />
      }
    />
  );
}

export function InboxPageContextColumn({
  flags,
  state,
  queries,
  composer,
  derived,
  actions,
  nowTick,
  mobile = false,
}: Props & { mobile?: boolean }) {
  const { canEditConversationTags } = flags;

  return (
    <InboxContextPanel
      displayName={derived.displayName}
      contactId={queries.contactId}
      contact={queries.contact}
      cadastroHref={queries.cadastroHref}
      onOpenProfile={() => {
        if (queries.cadastroHref) {
          openAppRouteInNewTab(queries.cadastroHref);
          return;
        }
        state.setProfileOpen(true);
      }}
      onOpenHistory={() => state.setHistoryOpen(true)}
      showSaveToContacts={actions.showSaveToContacts}
      saveContactBusy={actions.saveContactBusy}
      isDetailLoading={queries.isDetailLoading}
      saveContactHint={actions.saveContactHint}
      saveContactDuplicateId={actions.saveContactDuplicateId}
      onSaveContact={actions.onSaveConversationContact}
      onLinkExistingContact={actions.onLinkConversationToExistingContact}
      detail={queries.detail}
      active={queries.active}
      activeId={state.activeId}
      priorityOpen={state.priorityOpen}
      onTogglePriorityOpen={() => state.setPriorityOpen((v) => !v)}
      priorityMenuRef={state.priorityMenuRef}
      priorityLabel={derived.priorityLabel}
      priorityUi={derived.priorityUi}
      currentPriority={derived.currentPriority}
      onSetPriority={(priority) => void actions.setPriority(priority, () => state.setPriorityOpen(false))}
      slaCountdown={derived.slaCountdown}
      nowTick={nowTick}
      tagPickerRef={state.tagPickerRef}
      tagPickerOpen={state.tagPickerOpen}
      onToggleTagPicker={() => {
        if (!canEditConversationTags) return;
        state.setTagPickerOpen((o) => !o);
      }}
      canEditConversationTags={canEditConversationTags}
      conversationTagCatalog={queries.conversationTagCatalog}
      tagLabelBySlug={queries.tagLabelBySlug}
      tagToneBySlug={queries.tagToneBySlug}
      onAddTag={(slug) => void actions.addTagBySlug(slug, () => state.setTagPickerOpen(false))}
      onRemoveTag={actions.removeTagBySlug}
      isSending={composer.isSending}
      isUploading={composer.isUploading}
      isRecording={composer.isRecording}
      previousConversations={queries.previousConversations}
      mobile={mobile}
    />
  );
}

export function InboxPageCopilotSlot({ state, composer }: Pick<Props, 'state' | 'composer'>) {
  if (!state.copilotOpen) return null;
  return (
    <CopilotPanel
      embedded
      open={state.copilotOpen}
      collapsed={state.copilotCollapsed}
      onCollapsedChange={state.setCopilotCollapsed}
      onClose={() => state.setCopilotOpen(false)}
      conversationId={state.activeId || null}
      onInsertToComposer={composer.appendToComposer}
    />
  );
}

export function InboxPageOverlaysSlot({
  state,
  queries,
  composer,
  derived,
  actions,
  onSubmitNote,
  onAdvanceEntryDone,
  onConversationCreated,
  selectedChannelId,
}: Props) {
  return (
    <InboxOverlays
      profileOpen={state.profileOpen}
      onCloseProfile={() => state.setProfileOpen(false)}
      contactId={queries.contactId}
      fallbackPhone={queries.active?.phone}
      fallbackName={derived.displayName === '—' ? undefined : derived.displayName}
      historyOpen={state.historyOpen}
      onCloseHistory={() => state.setHistoryOpen(false)}
      detail={queries.detail}
      noteOpen={state.noteOpen}
      onCloseNote={() => state.setNoteOpen(false)}
      noteText={state.noteText}
      onNoteTextChange={state.setNoteText}
      noteCaret={state.noteCaret}
      onNoteCaretChange={state.setNoteCaret}
      noteTextareaRef={state.noteTextareaRef}
      filteredMentionCandidates={queries.filteredMentionCandidates}
      noteHint={state.noteHint}
      isSending={composer.isSending}
      onSubmitNote={onSubmitNote}
      transferOpen={actions.transferOpen}
      onCloseTransfer={() => actions.setTransferOpen(false)}
      transferSectorId={actions.transferSectorId}
      onTransferSectorIdChange={actions.setTransferSectorId}
      transferAttendantId={actions.transferAttendantId}
      onTransferAttendantIdChange={actions.setTransferAttendantId}
      transferReason={actions.transferReason}
      onTransferReasonChange={actions.setTransferReason}
      sectors={queries.sectors}
      users={queries.users}
      onSubmitTransfer={actions.submitTransfer}
      advanceEntryDrawerOpen={state.advanceEntryDrawerOpen}
      advanceEntryTaskId={state.advanceEntryTaskId}
      advanceEntryContext={queries.advanceEntryContext}
      onCloseAdvanceEntry={state.closeAdvanceEntry}
      onAdvanceEntryDone={onAdvanceEntryDone}
      showNewConversation={state.showNewConversation}
      onCloseNewConversation={() => state.setShowNewConversation(false)}
      templatesData={queries.templatesData}
      workspaceChannelId={selectedChannelId}
      onConversationCreated={onConversationCreated}
    />
  );
}

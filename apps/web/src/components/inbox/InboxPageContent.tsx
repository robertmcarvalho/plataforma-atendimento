'use client';

import { useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { InboxFolderColumn } from '@/components/inbox/InboxFolderColumn';
import { InboxMobileFolderBar } from '@/components/inbox/InboxMobileFolderBar';
import {
  InboxPageContextColumn,
  InboxPageCopilotSlot,
  InboxPageDetailColumn,
  InboxPageListColumn,
  InboxPageOverlaysSlot,
} from '@/components/inbox/InboxPageColumns';
import { InboxPageShell } from '@/components/inbox/InboxPageShell';
import { OperationalSessionHeader } from '@/components/operational/OperationalSessionHeader';
import { Button } from '@/components/ui/button';
import { useIsLgUp } from '@/hooks/useMediaQuery';
import type { InboxPageController } from '@/lib/inbox/useInboxPageController';

export function InboxPageContent(props: InboxPageController) {
  const { inboxDensity, flags, state, layout, queries, notifications } = props;
  const { isSupervisor } = flags;
  const isLgUp = useIsLgUp();
  const [contextSheetOpen, setContextSheetOpen] = useState(false);

  const folderColumnProps = {
    filterOpen: state.filterOpen,
    onToggleFilter: () => state.setFilterOpen((v) => !v),
    onCloseFilter: () => state.setFilterOpen(false),
    search: state.search,
    onSearchChange: state.setSearch,
    statusFilter: state.statusFilter,
    onStatusFilterChange: state.setStatusFilter,
    priorityFilter: state.priorityFilter,
    onPriorityFilterChange: state.setPriorityFilter,
    isSupervisor,
    canFilterByAttendant: flags.canFilterByAttendant,
    supervisorAttendantId: state.supervisorAttendantId,
    onSupervisorAttendantIdChange: state.setSupervisorAttendantId,
    supervisorAttendants: queries.supervisorAttendants,
    teamPresence: queries.teamPresence,
    supervisorAttendanceGroup: state.supervisorAttendanceGroup,
    onSupervisorAttendanceGroupChange: state.setSupervisorAttendanceGroup,
    supervisorSlaStage: state.supervisorSlaStage,
    onSupervisorSlaStageChange: state.setSupervisorSlaStage,
    supervisorSlaBucket: state.supervisorSlaBucket,
    onSupervisorSlaBucketChange: state.setSupervisorSlaBucket,
    sectorFilterId: state.sectorFilterId,
    onSectorFilterIdChange: state.setSectorFilterId,
    sectors: queries.sectors ?? [],
    onClearFilters: state.clearFilters,
    folders: queries.folders,
    folder: state.folder,
    onFolderSelect: (key: Parameters<typeof state.handleFolderSelect>[0]) =>
      state.handleFolderSelect(key, notifications.openNotifications),
    channelFilter: state.channelFilter,
    onChannelFilterToggle: state.toggleChannelFilter,
    channelCounts: queries.channelCounts,
    canStartStaffConversation: flags.canStartStaffConversation,
    notifications,
  };

  const folderColumn = <InboxFolderColumn {...folderColumnProps} />;

  if (!isLgUp) {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col" data-inbox-density={inboxDensity}>
        <OperationalSessionHeader />
        {!state.activeId ? (
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <InboxMobileFolderBar {...folderColumnProps} />
            <div className="min-h-0 flex-1 overflow-hidden">
              <InboxPageListColumn {...props} />
            </div>
          </div>
        ) : (
          <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
            <InboxPageDetailColumn
              {...props}
              onBack={() => {
                setContextSheetOpen(false);
                state.setActiveId('');
              }}
              onOpenContext={() => setContextSheetOpen(true)}
            />
            {contextSheetOpen ? (
              <div className="absolute inset-0 z-30 flex min-h-0 flex-col bg-background">
                <div className="flex shrink-0 items-center gap-2 border-b border-border px-2 py-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setContextSheetOpen(false)}
                    aria-label="Voltar para o chat"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </Button>
                  <span className="text-sm font-semibold">Contexto</span>
                </div>
                <div className="min-h-0 flex-1 overflow-hidden">
                  <InboxPageContextColumn {...props} mobile />
                </div>
              </div>
            ) : null}
          </div>
        )}
        {props.state.copilotOpen ? (
          <div className="fixed inset-0 z-40 flex flex-col bg-background/95 backdrop-blur-sm">
            <InboxPageCopilotSlot state={props.state} composer={props.composer} />
          </div>
        ) : null}
        <InboxPageOverlaysSlot {...props} />
      </div>
    );
  }

  return (
    <InboxPageShell
      inboxDensity={inboxDensity}
      inboxGridColumns={layout.inboxGridColumns}
      onResizeFolder={layout.startResizeFolderColumn}
      onResizeList={layout.startResizeListColumn}
      onResizeContext={layout.startResizeContextColumn}
      folderColumn={folderColumn}
      listColumn={<InboxPageListColumn {...props} />}
      detailColumn={<InboxPageDetailColumn {...props} />}
      contextColumn={<InboxPageContextColumn {...props} />}
      copilot={<InboxPageCopilotSlot state={props.state} composer={props.composer} />}
      overlays={<InboxPageOverlaysSlot {...props} />}
    />
  );
}

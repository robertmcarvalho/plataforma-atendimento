'use client';

import type { ReactNode } from 'react';
import { OperationalSessionHeader } from '@/components/operational/OperationalSessionHeader';

type ResizeHandler = (e: { preventDefault: () => void; clientX: number }) => void;

export type InboxPageShellProps = {
  inboxDensity: string;
  inboxGridColumns: string;
  folderColumn: ReactNode;
  listColumn: ReactNode;
  detailColumn: ReactNode;
  contextColumn: ReactNode;
  copilot?: ReactNode;
  onResizeFolder: ResizeHandler;
  onResizeList: ResizeHandler;
  onResizeContext: ResizeHandler;
  overlays?: ReactNode;
};

function ColumnResizer({
  label,
  onMouseDown,
  className = '',
}: {
  label: string;
  onMouseDown: ResizeHandler;
  className?: string;
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      onMouseDown={onMouseDown}
      className={`relative min-h-0 cursor-col-resize bg-border/60 transition-colors hover:bg-primary/40 ${className}`}
      title="Arraste para ajustar a largura"
    >
      <div className="absolute inset-y-0 left-1/2 w-3 -translate-x-1/2" aria-hidden />
    </div>
  );
}

export function InboxPageShell({
  inboxDensity,
  inboxGridColumns,
  folderColumn,
  listColumn,
  detailColumn,
  contextColumn,
  copilot,
  onResizeFolder,
  onResizeList,
  onResizeContext,
  overlays,
}: InboxPageShellProps) {
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col" data-inbox-density={inboxDensity}>
      <OperationalSessionHeader />
      <div className="grid min-h-0 min-w-0 flex-1" style={{ gridTemplateColumns: inboxGridColumns }}>
        {folderColumn}
        <ColumnResizer label="Redimensionar coluna de pastas e filtros" onMouseDown={onResizeFolder} />
        {listColumn}
        <ColumnResizer label="Redimensionar lista de conversas" onMouseDown={onResizeList} />
        {detailColumn}
        <ColumnResizer
          label="Redimensionar painel de contexto"
          onMouseDown={onResizeContext}
          className="hidden lg:block"
        />
        {contextColumn}
        {copilot}
      </div>
      {overlays}
    </div>
  );
}

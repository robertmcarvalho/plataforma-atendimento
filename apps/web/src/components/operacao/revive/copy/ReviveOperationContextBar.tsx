'use client';

import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/store/auth';

export function ReviveOperationContextBar({ breadcrumb = [] }: { breadcrumb?: string[] }) {
  const workspaceName = useAuth((s) => s.user?.workspace_name) || 'Workspace';

  return (
    <div className="mb-4 flex items-center gap-2 rounded-md border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
      </span>
      <span className="font-medium">Operando em:</span>
      <span>{workspaceName}</span>
      {breadcrumb.map((item, i) => (
        <span key={i} className="flex items-center gap-1 text-primary/80">
          <ChevronRight className="h-3 w-3" />
          {item}
        </span>
      ))}
    </div>
  );
}

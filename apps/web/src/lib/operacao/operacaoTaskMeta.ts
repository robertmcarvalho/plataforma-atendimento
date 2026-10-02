import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ClipboardList,
  FileMinus2,
  FilePlus2,
  FileWarning,
  IdCard,
  Wallet,
} from 'lucide-react';
import {
  BUILTIN_OPS_TASK_CATALOG,
  type OpsTaskCatalogEntry,
  type OpsTaskIconTone,
} from '@plataforma/ops-task-catalog';
import type { IconTileTone } from '@/components/ui/IconTile';

export type TaskMeta = {
  label: string;
  icon: LucideIcon;
  tone: IconTileTone;
};

const ICON_MAP: Record<string, LucideIcon> = {
  FilePlus2,
  IdCard,
  FileMinus2,
  Wallet,
  FileWarning,
  AlertTriangle,
  ClipboardList,
};

function toneFromCatalog(tone: OpsTaskIconTone): IconTileTone {
  if (tone === 'info') return 'primary';
  return tone as IconTileTone;
}

export function catalogEntryToMeta(entry: OpsTaskCatalogEntry): TaskMeta {
  return {
    label: entry.label,
    icon: ICON_MAP[entry.icon] || ClipboardList,
    tone: toneFromCatalog(entry.tone),
  };
}

/** Fallback local quando API ainda não carregou. */
export const OPERACAO_TASK_META: Record<string, TaskMeta> = Object.fromEntries(
  BUILTIN_OPS_TASK_CATALOG.map((e) => [e.task_type, catalogEntryToMeta(e)])
);

export type CreateTaskKind = string;

export function taskMetaForType(taskType: string, catalog?: OpsTaskCatalogEntry[]): TaskMeta {
  const fromCatalog = catalog?.find((e) => e.task_type === taskType);
  if (fromCatalog) return catalogEntryToMeta(fromCatalog);
  return (
    OPERACAO_TASK_META[taskType] ?? {
      label: taskType.replace(/_/g, ' '),
      icon: ClipboardList,
      tone: 'muted' as IconTileTone,
    }
  );
}

export function initialsFromName(name: string): string {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!parts.length) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

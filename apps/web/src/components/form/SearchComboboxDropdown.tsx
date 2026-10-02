'use client';

import { useEffect, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { interactiveActive, interactiveHover } from '@/lib/interactiveRow';
import { cn } from '@/lib/utils';

const DROPDOWN_MAX_HEIGHT = 224;

function useAnchoredStyle(anchorRef: RefObject<HTMLElement | null>, enabled: boolean) {
  const [style, setStyle] = useState<React.CSSProperties>();

  useEffect(() => {
    if (!enabled || !anchorRef.current) return;

    const update = () => {
      const anchor = anchorRef.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 8;
      const spaceAbove = rect.top - 8;
      const openUp = spaceBelow < 120 && spaceAbove > spaceBelow;
      const maxHeight = Math.min(DROPDOWN_MAX_HEIGHT, openUp ? spaceAbove : spaceBelow);

      if (openUp) {
        setStyle({
          position: 'fixed',
          left: rect.left,
          bottom: window.innerHeight - rect.top + 4,
          width: rect.width,
          maxHeight,
        });
      } else {
        setStyle({
          position: 'fixed',
          top: rect.bottom + 4,
          left: rect.left,
          width: rect.width,
          maxHeight,
        });
      }
    };

    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => {
      window.removeEventListener('scroll', update, true);
      window.removeEventListener('resize', update);
    };
  }, [anchorRef, enabled]);

  return style;
}

export function SearchComboboxDropdown({
  items,
  value,
  onPick,
  loading,
  error,
  emptyLabel,
  loadingLabel = 'Buscando…',
  anchorRef,
  portal = false,
  highlightIndex = -1,
}: {
  items: Array<{ id: string; label: string }>;
  value: string;
  onPick: (id: string, label: string) => void;
  loading?: boolean;
  error?: string | null;
  emptyLabel: string;
  loadingLabel?: string;
  anchorRef?: RefObject<HTMLElement | null>;
  portal?: boolean;
  highlightIndex?: number;
}) {
  const usePortal = portal && Boolean(anchorRef);
  const anchoredStyle = useAnchoredStyle(anchorRef ?? { current: null }, usePortal);

  const panel = (
    <div
      role="listbox"
      className={cn(
        'overflow-y-auto rounded-md border border-border bg-background shadow-lg',
        usePortal ? 'z-[200]' : 'absolute z-50 mt-1 max-h-56 w-full'
      )}
      style={usePortal ? anchoredStyle : undefined}
    >
      {loading ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{loadingLabel}</p>
      ) : error ? (
        <p className="px-3 py-2 text-xs text-destructive">{error}</p>
      ) : items.length === 0 ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">{emptyLabel}</p>
      ) : (
        items.map((item, index) => (
          <button
            key={item.id}
            type="button"
            role="option"
            aria-selected={value === item.id}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onPick(item.id, item.label)}
            className={cn(
              'flex w-full px-3 py-2 text-left text-sm transition-colors',
              value === item.id || highlightIndex === index ? interactiveActive : interactiveHover
            )}
          >
            {item.label}
          </button>
        ))
      )}
    </div>
  );

  if (usePortal && typeof document !== 'undefined') {
    return createPortal(panel, document.body);
  }

  return panel;
}

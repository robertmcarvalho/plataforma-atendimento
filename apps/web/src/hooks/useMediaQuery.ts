'use client';

import { useSyncExternalStore } from 'react';

function subscribeMedia(query: string, onChange: () => void) {
  const mq = window.matchMedia(query);
  mq.addEventListener('change', onChange);
  return () => mq.removeEventListener('change', onChange);
}

function getMediaSnapshot(query: string) {
  return window.matchMedia(query).matches;
}

/** Tailwind `lg` breakpoint — min-width 1024px */
export function useMediaQuery(query: string, fallback = false) {
  return useSyncExternalStore(
    (onChange) => subscribeMedia(query, onChange),
    () => getMediaSnapshot(query),
    () => fallback
  );
}

export function useIsLgUp() {
  return useMediaQuery('(min-width: 1024px)', true);
}

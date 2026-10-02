import { useEffect, useState } from 'react';

/** true quando a aba está visível (document.hidden === false). */
export function useDocumentVisible(): boolean {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden
  );

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onChange = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', onChange);
    return () => document.removeEventListener('visibilitychange', onChange);
  }, []);

  return visible;
}

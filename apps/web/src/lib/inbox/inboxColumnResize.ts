export function startColumnResize(
  e: { preventDefault: () => void; clientX: number },
  startWidth: number,
  onWidth: (width: number) => void,
  min: number,
  max: number,
  invertDelta = false
) {
  e.preventDefault();
  const startX = e.clientX;
  const onMove = (ev: MouseEvent) => {
    const delta = ev.clientX - startX;
    const next = invertDelta ? startWidth - delta : startWidth + delta;
    onWidth(Math.min(max, Math.max(min, next)));
  };
  const onUp = () => {
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', onUp);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  };
  document.body.style.cursor = 'col-resize';
  document.body.style.userSelect = 'none';
  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);
}

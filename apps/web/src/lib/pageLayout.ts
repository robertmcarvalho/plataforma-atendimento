/** Padding horizontal padrão para páginas (mobile-first). */
export const pageContentPaddingClassName = 'px-4 sm:px-8';

/** Padding vertical padrão para páginas. */
export const pageContentVerticalPaddingClassName = 'py-6 sm:py-8';

/** Container centralizado com padding responsivo (max-w-7xl). */
export const pageContainerClassName = `mx-auto max-w-7xl ${pageContentPaddingClassName} ${pageContentVerticalPaddingClassName}`;

/** Container com largura customizável. */
export function pageContainerClass(maxWidthClassName = 'max-w-7xl') {
  return `mx-auto ${maxWidthClassName} ${pageContentPaddingClassName} ${pageContentVerticalPaddingClassName}`;
}

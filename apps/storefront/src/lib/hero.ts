import type { MediaRef } from '@femia/contracts';

export const PHONE = '(max-width: 767px)';
export const WIDE = '(min-width: 768px)';

/**
 * Which photos the hero shows. The desktop photo follows the chosen style (side or full-width) and falls back to
 * the other one, so switching style never leaves the banner empty; phones use their own photo when there is one.
 */
export function heroImages(d: Record<string, any>, media: Record<string, MediaRef>) {
  const get = (id?: string | null) => (id ? media[id] : undefined);
  const layout: 'side' | 'full' = d.layout === 'full' ? 'full' : 'side';
  const desktop = layout === 'full' ? get(d.imageWide) ?? get(d.image) : get(d.image) ?? get(d.imageWide);
  const mobile = get(d.imageMobile);
  const desktopSizes = layout === 'full' ? '100vw' : `${WIDE} 58vw, 100vw`;
  return { layout, desktop, mobile, desktopSizes };
}

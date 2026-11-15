import type { MediaRef } from '@femia/contracts';

/** Screen sizes for the device-specific banner photos (match the Admin labels and the CSS breakpoints). */
export const PHONE = '(max-width: 767px)';
export const TABLET = '(min-width: 768px) and (max-width: 1199px)';
export const DESKTOP = '(min-width: 1200px)';

/**
 * A banner's desktop / tablet / phone photos. Each falls back to the next larger one that exists,
 * so the owner can upload only a desktop photo and still get a banner everywhere.
 */
export function deviceImages(d: Record<string, any>, media: Record<string, MediaRef>) {
  const get = (id?: string | null) => (id ? media[id] : undefined);
  const desktop = get(d.image) ?? get(d.imageTablet) ?? get(d.imageMobile);
  const tablet = get(d.imageTablet) ?? desktop;
  const mobile = get(d.imageMobile) ?? tablet;
  return { desktop, tablet, mobile, ownTablet: !!get(d.imageTablet), ownMobile: !!get(d.imageMobile) };
}
export type DeviceImages = ReturnType<typeof deviceImages>;

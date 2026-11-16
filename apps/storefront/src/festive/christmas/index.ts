import type { FestiveTheme } from '../index.ts';
import { isFestivalDay, mount, type Drop } from '../kit.ts';

/**
 * Christmas, embroidered in zari: a gold-thread pine swag along the header with zari stars and pine and berry
 * baubles hanging from its pins, gold dust (or soft snow), a pine-green seal on the home page, a pine-green
 * announcement bar, a footer hem stitched with fir trees and stars, and stars for the gold diamonds.
 * On 25 December the seal says "Merry Christmas" and the sparkle is a little richer.
 */
type Opts = { sparkle: 'gold' | 'snow' | 'off'; garland: boolean; stars: boolean; seal: boolean; sealText: string; sealLink: string; details: boolean; christmasDay: boolean };
const DEFAULTS: Opts = { sparkle: 'gold', garland: true, stars: true, seal: true, sealText: 'The Christmas Edit', sealLink: '/shop', details: true, christmasDay: true };

const DROPS: Drop[] = [
  { pin: -2, len: 34, w: 36, art: 'star.svg', from: 'md' },
  { pin: -1, len: 62, w: 40, art: 'bauble-berry.svg', from: 'lg' },
  { pin: 1, len: 40, w: 40, art: 'bauble-pine.svg', from: 'lg' },
  { pin: 2, len: 70, w: 30, art: 'star.svg', from: 'md' },
  { pin: -3, len: 52, w: 28, art: 'star.svg', from: 'lg' },
  { pin: 3, len: 26, w: 38, art: 'bauble-berry.svg', from: 'lg' },
];

const CSS = `
html[data-festive-on="christmas"] {
  --fx-bar: #1F4D3A; --fx-bar-2: #12331F; --fx-bar-ink: #F6EBDD;
  --fx-disc-1: #2A5E45; --fx-disc-2: #18402E; --fx-disc-3: #0D2519; --fx-ring: #EBCB82;
  --fx-mark: url('/festive/christmas/mark.svg');
}`;

const theme: FestiveTheme = {
  start(root, options) {
    const o: Opts = { ...DEFAULTS, ...(options as Partial<Opts>) };
    const day = o.christmasDay && isFestivalDay('12-25');
    return mount(root, {
      id: 'christmas',
      strip: o.garland ? { w: 260, h: 52 } : null,
      drops: o.stars ? DROPS : [],
      sparkle: o.sparkle,
      rich: day,
      seal: o.seal ? { text: o.sealText || DEFAULTS.sealText, link: o.sealLink || '/shop', greeting: day ? 'Merry Christmas' : null } : null,
      details: o.details,
      css: CSS,
    });
  },
};
export default theme;

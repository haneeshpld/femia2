import type { FestiveTheme } from '../index.ts';
import { isFestivalDay, mount, type Drop } from '../kit.ts';

/**
 * Bakrid, a dressed doorway: a scalloped toran in deep teal edged with zari along the header, eight-point star
 * medallions and gold tassels hanging from it, a little gold dust, a teal seal and announcement bar, a jaali
 * border stitched along the footer, and eight-point stars for the gold diamonds.
 * On the day the owner picks, the seal shows their greeting.
 */
type Opts = { sparkle: 'gold' | 'off'; toran: boolean; medallions: boolean; seal: boolean; sealText: string; sealLink: string; details: boolean; greetingDay: string | null; greetingText: string };
const DEFAULTS: Opts = { sparkle: 'gold', toran: true, medallions: true, seal: true, sealText: 'The Celebration Edit', sealLink: '/shop', details: true, greetingDay: null, greetingText: 'Eid Mubarak' };

// The toran's pins are 80px apart; medallions and tassels hang at both edges, the middle stays open.
const DROPS: Drop[] = [
  { pin: -8, len: 28, w: 50, art: 'medallion.svg', from: 'md' },
  { pin: 8, len: 46, w: 46, art: 'medallion.svg', from: 'md' },
  { pin: -6, len: 14, w: 20, art: 'tassel.svg', from: 'lg' },
  { pin: 6, len: 22, w: 20, art: 'tassel.svg', from: 'lg' },
  { pin: -4, len: 54, w: 34, art: 'medallion.svg', from: 'lg' },
  { pin: 4, len: 10, w: 34, art: 'medallion.svg', from: 'lg' },
  { pin: -10, len: 12, w: 18, art: 'tassel.svg', from: 'lg' },
  { pin: 10, len: 24, w: 18, art: 'tassel.svg', from: 'lg' },
];

const CSS = `
html[data-festive-on="bakrid"] {
  --fx-bar: #175058; --fx-bar-2: #0C3A40; --fx-bar-ink: #FBF5EA;
  --fx-disc-1: #1F6670; --fx-disc-2: #124850; --fx-disc-3: #082C31; --fx-ring: #F2C879;
  --fx-mark: url('/festive/bakrid/mark.svg');
}`;

const theme: FestiveTheme = {
  start(root, options) {
    const o: Opts = { ...DEFAULTS, ...(options as Partial<Opts>) };
    const day = isFestivalDay(o.greetingDay) && !!o.greetingText;
    return mount(root, {
      id: 'bakrid',
      strip: o.toran ? { w: 80, h: 57 } : null,
      drops: o.medallions ? DROPS : [],
      sparkle: o.sparkle === 'gold' ? 'dust' : 'off',
      rich: day,
      seal: o.seal ? { text: o.sealText || DEFAULTS.sealText, link: o.sealLink || '/shop', greeting: day ? o.greetingText : null } : null,
      details: o.details,
      css: CSS,
    });
  },
};
export default theme;

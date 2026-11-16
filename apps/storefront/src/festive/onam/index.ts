import type { FestiveTheme } from '../index.ts';
import { isFestivalDay, mount, type Drop } from '../kit.ts';

/**
 * Onam, a Kerala doorway at harvest: a thoranam of mango leaves and marigolds along the header, pookalam
 * medallions and marigold strings hanging from it, marigold and chethi petals drifting down, a kasavu-cream
 * announcement bar, the gold kasavu border along the footer, and small flowers for the gold diamonds.
 * On the day the owner picks (Thiruvonam), the seal shows their greeting.
 */
type Opts = { sparkle: 'petals' | 'off'; thoranam: boolean; flowers: boolean; seal: boolean; sealText: string; sealLink: string; details: boolean; greetingDay: string | null; greetingText: string };
const DEFAULTS: Opts = { sparkle: 'petals', thoranam: true, flowers: true, seal: true, sealText: 'The Harvest Edit', sealLink: '/shop', details: true, greetingDay: null, greetingText: 'Happy Onam' };

// The thoranam's pins are 96px apart (a marigold at each); the middle stays open.
const DROPS: Drop[] = [
  { pin: -6, len: 30, w: 52, art: 'pookalam.svg', from: 'md' },
  { pin: 6, len: 48, w: 48, art: 'pookalam.svg', from: 'md' },
  { pin: -5, len: 14, w: 20, art: 'marigolds.svg', from: 'lg' },
  { pin: 5, len: 8, w: 20, art: 'marigolds.svg', from: 'lg' },
  { pin: -3, len: 56, w: 36, art: 'pookalam.svg', from: 'lg' },
  { pin: 3, len: 18, w: 36, art: 'pookalam.svg', from: 'lg' },
  { pin: -7, len: 6, w: 18, art: 'marigolds.svg', from: 'lg' },
  { pin: 7, len: 20, w: 18, art: 'marigolds.svg', from: 'lg' },
];

const CSS = `
html[data-festive-on="onam"] {
  --fx-bar: #F7EDD3; --fx-bar-2: #EEDDB4; --fx-bar-ink: #3B2A18;
  --fx-disc-1: #C9502C; --fx-disc-2: #9E3418; --fx-disc-3: #63190A; --fx-ring: #F6D58A;
  --fx-mark: url('/festive/onam/mark.svg');
}
/* the bar as kasavu cloth: cream with a gold border at its foot */
html[data-fx-details][data-festive-on="onam"] .announce { box-shadow: inset 0 -3px 0 #D6A647, inset 0 -4px 0 #A9781F; }`;

const theme: FestiveTheme = {
  start(root, options) {
    const o: Opts = { ...DEFAULTS, ...(options as Partial<Opts>) };
    const day = isFestivalDay(o.greetingDay) && !!o.greetingText;
    return mount(root, {
      id: 'onam',
      strip: o.thoranam ? { w: 96, h: 52 } : null,
      drops: o.flowers ? DROPS : [],
      sparkle: o.sparkle === 'petals' ? 'marigold' : 'off',
      rich: day,
      seal: o.seal ? { text: o.sealText || DEFAULTS.sealText, link: o.sealLink || '/shop', greeting: day ? o.greetingText : null } : null,
      details: o.details,
      css: CSS,
    });
  },
};
export default theme;

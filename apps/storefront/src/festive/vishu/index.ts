import type { FestiveTheme } from '../index.ts';
import { isFestivalDay, mount, type Drop } from '../kit.ts';

/**
 * Vishu, under the kanikonna: a leafy konna branch along the header with golden-shower clusters hanging from it,
 * yellow petals drifting down, a leaf-green announcement bar and seal, konna flowers along the footer, and small
 * flowers for the gold diamonds. On the day the owner picks, the seal shows their greeting.
 */
type Opts = { sparkle: 'petals' | 'off'; branch: boolean; blossoms: boolean; seal: boolean; sealText: string; sealLink: string; details: boolean; greetingDay: string | null; greetingText: string };
const DEFAULTS: Opts = { sparkle: 'petals', branch: true, blossoms: true, seal: true, sealText: 'The Golden Edit', sealLink: '/shop', details: true, greetingDay: null, greetingText: 'Happy Vishu' };

// Clusters of different lengths hang like a flowering tree's edge; the branch's pins are 150px apart.
const DROPS: Drop[] = [
  { pin: -4, len: 4, w: 40, art: 'konna.svg', from: 'md' },
  { pin: 4, len: 10, w: 38, art: 'konna.svg', from: 'md' },
  { pin: -3, len: 2, w: 32, art: 'konna-short.svg', from: 'lg' },
  { pin: 3, len: 6, w: 34, art: 'konna-short.svg', from: 'lg' },
  { pin: -2, len: 8, w: 28, art: 'konna-short.svg', from: 'lg' },
  { pin: 2, len: 0, w: 34, art: 'konna.svg', from: 'lg' },
];

const CSS = `
html[data-festive-on="vishu"] {
  --fx-bar: #335F26; --fx-bar-2: #22461A; --fx-bar-ink: #FBF3D8;
  --fx-disc-1: #44803A; --fx-disc-2: #2C5E24; --fx-disc-3: #183C12; --fx-ring: #F8D85A;
  --fx-mark: url('/festive/vishu/mark.svg');
}
/* the clusters hang from the branch itself, not on threads */
html[data-festive-on="vishu"] .fx-drop::before { background: #7E8F2C; width: 1.2px; }`;

const theme: FestiveTheme = {
  start(root, options) {
    const o: Opts = { ...DEFAULTS, ...(options as Partial<Opts>) };
    const day = isFestivalDay(o.greetingDay) && !!o.greetingText;
    return mount(root, {
      id: 'vishu',
      strip: o.branch ? { w: 150, h: 46 } : null,
      drops: o.blossoms ? DROPS : [],
      sparkle: o.sparkle === 'petals' ? 'konna' : 'off',
      rich: day,
      seal: o.seal ? { text: o.sealText || DEFAULTS.sealText, link: o.sealLink || '/shop', greeting: day ? o.greetingText : null } : null,
      details: o.details,
      css: CSS,
    });
  },
};
export default theme;

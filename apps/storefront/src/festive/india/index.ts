import type { FestiveTheme } from '../index.ts';
import { isFestivalDay, mount, type Drop } from '../kit.ts';

/**
 * India's national days (Republic Day, Independence Day): tricolour pennant bunting along the header, kites and
 * tricolour rosettes hanging from it, saffron, white and green petals drifting down, a navy announcement bar with a
 * tricolour edge, a tricolour border with the chakra along the footer, and the chakra for the gold diamonds.
 * On 26 January and 15 August the seal wishes shoppers a happy Republic Day or Independence Day.
 */
type Opts = { sparkle: 'petals' | 'off'; bunting: boolean; kites: boolean; seal: boolean; sealText: string; sealLink: string; details: boolean; dayGreeting: boolean };
const DEFAULTS: Opts = { sparkle: 'petals', bunting: true, kites: true, seal: true, sealText: 'Celebrating India', sealLink: '/shop', details: true, dayGreeting: true };

// The bunting's pins are 144px apart: rosettes nearer the middle, kites flying at the edges.
const DROPS: Drop[] = [
  { pin: -4, len: 36, w: 56, art: 'kite.svg', from: 'md' },
  { pin: 4, len: 56, w: 52, art: 'kite.svg', from: 'md' },
  { pin: -3, len: 18, w: 34, art: 'rosette.svg', from: 'lg' },
  { pin: 3, len: 30, w: 34, art: 'rosette.svg', from: 'lg' },
  { pin: -2, len: 60, w: 28, art: 'rosette.svg', from: 'lg' },
  { pin: 2, len: 12, w: 40, art: 'kite.svg', from: 'lg' },
];

const CSS = `
html[data-festive-on="india"] {
  --fx-bar: #22337A; --fx-bar-2: #16235A; --fx-bar-ink: #FFFFFF;
  --fx-disc-1: #2B3D8A; --fx-disc-2: #1C2A6A; --fx-disc-3: #101A4A; --fx-ring: #FFD9A8;
  --fx-mark: url('/festive/india/mark.svg');
}
html[data-fx-details][data-festive-on="india"] .announce::after {
  content: ''; position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
  background: linear-gradient(90deg, #F08A24 0 33.33%, #FFFFFF 33.33% 66.66%, #178A3C 66.66%);
}`;

const theme: FestiveTheme = {
  start(root, options) {
    const o: Opts = { ...DEFAULTS, ...(options as Partial<Opts>) };
    const greeting = !o.dayGreeting ? null
      : isFestivalDay('01-26') ? 'Happy Republic Day'
      : isFestivalDay('08-15') ? 'Happy Independence Day'
      : null;
    return mount(root, {
      id: 'india',
      strip: o.bunting ? { w: 144, h: 40 } : null,
      drops: o.kites ? DROPS : [],
      sparkle: o.sparkle === 'petals' ? 'tricolour' : 'off',
      rich: !!greeting,
      seal: o.seal ? { text: o.sealText || DEFAULTS.sealText, link: o.sealLink || '/shop', greeting } : null,
      details: o.details,
      css: CSS,
    });
  },
};
export default theme;

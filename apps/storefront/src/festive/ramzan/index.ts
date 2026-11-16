import type { FestiveTheme } from '../index.ts';
import { isFestivalDay, mount, type Drop } from '../kit.ts';

/**
 * Ramzan and Eid al-Fitr, a lantern night: a strand of warm lights on a zari thread along the header, brass
 * lanterns and crescents hanging at both edges like a lit doorway, lantern light drifting up the page, a night-blue
 * seal and announcement bar, a mehndi vine stitched along the footer, and crescents for the gold diamonds.
 * On the day the owner picks, the seal shows their greeting.
 */
type Opts = { sparkle: 'glow' | 'off'; lights: boolean; lanterns: boolean; seal: boolean; sealText: string; sealLink: string; details: boolean; greetingDay: string | null; greetingText: string };
const DEFAULTS: Opts = { sparkle: 'glow', lights: true, lanterns: true, seal: true, sealText: 'The Festive Edit', sealLink: '/shop', details: true, greetingDay: null, greetingText: 'Eid Mubarak' };

// Framing the edges: lanterns, then crescents, small stars between. Pins are 200px apart.
const DROPS: Drop[] = [
  { pin: -3, len: 26, w: 54, art: 'lantern.svg', from: 'md', glow: true },
  { pin: 3, len: 44, w: 50, art: 'lantern.svg', from: 'md', glow: true },
  { pin: -2, len: 64, w: 40, art: 'crescent.svg', from: 'lg' },
  { pin: 2, len: 20, w: 42, art: 'crescent.svg', from: 'lg' },
  { pin: -4, len: 70, w: 20, art: 'star.svg', from: 'lg' },
  { pin: 4, len: 40, w: 22, art: 'star.svg', from: 'lg' },
  { pin: -1, len: 30, w: 18, art: 'star.svg', from: 'lg' },
  { pin: 1, len: 52, w: 16, art: 'star.svg', from: 'lg' },
];

const CSS = `
html[data-festive-on="ramzan"] {
  --fx-bar: #262B57; --fx-bar-2: #1A1D40; --fx-bar-ink: #F3EEDF;
  --fx-disc-1: #343A72; --fx-disc-2: #222653; --fx-disc-3: #14163A; --fx-ring: #F0D9A0;
  --fx-mark: url('/festive/ramzan/mark.svg');
}`;

const theme: FestiveTheme = {
  start(root, options) {
    const o: Opts = { ...DEFAULTS, ...(options as Partial<Opts>) };
    const day = isFestivalDay(o.greetingDay) && !!o.greetingText;
    return mount(root, {
      id: 'ramzan',
      strip: o.lights ? { w: 200, h: 44 } : null,
      drops: o.lanterns ? DROPS : [],
      sparkle: o.sparkle,
      rich: day,
      seal: o.seal ? { text: o.sealText || DEFAULTS.sealText, link: o.sealLink || '/shop', greeting: day ? o.greetingText : null } : null,
      details: o.details,
      css: CSS,
    });
  },
};
export default theme;

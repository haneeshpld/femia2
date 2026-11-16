/**
 * "Boutique daylight": the hero's window light follows the real time at the boutique (IST).
 * Morning light is pale gold and leans one way, noon is short and bright, late afternoon is long and amber;
 * after closing time the window goes dark and a warm lamp glow takes over. Pure, so server and client agree.
 */

export interface Daylight {
  /** CSS custom properties for the hero */
  vars: Record<string, string>;
  /** "4:12 PM" in IST */
  clock: string;
}

const DAWN = 6 * 60;      // window light starts
const DUSK = 19 * 60;     // and is gone by 7 PM
const TWILIGHT = 40;      // minutes of crossfade with the lamp at each end

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(lerp(v, b[i]!, t)));

const DAWN_RGB = [255, 222, 178];   // pale morning gold
const NOON_RGB = [255, 244, 222];   // near-white, warm
const GOLD_RGB = [255, 196, 128];   // late-afternoon amber

/** Minutes after midnight in IST. */
export const istMinutes = (now = new Date()) => {
  const ist = new Date(now.getTime() + 330 * 60_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
};

export function daylight(now = new Date()): Daylight {
  const m = istMinutes(now);
  const t = clamp01((m - DAWN) / (DUSK - DAWN)); // 0 at dawn, 1 at dusk
  const arc = Math.sin(Math.PI * t);              // 0 at the ends, 1 at noon
  const inDay = m >= DAWN && m <= DUSK;
  // Lamp takes over smoothly in the last/first TWILIGHT minutes of the day.
  const edge = inDay ? Math.min(m - DAWN, DUSK - m) : 0;
  const sun = inDay ? clamp01(edge / TWILIGHT) : 0;

  const rgb = t < 0.5 ? mix(DAWN_RGB, NOON_RGB, arc) : mix(GOLD_RGB, NOON_RGB, arc);
  const h = Math.floor(m / 60), min = m % 60;
  const clock = `${h % 12 || 12}:${String(min).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;

  return {
    clock,
    vars: {
      '--sun-skew': `${lerp(24, -24, t).toFixed(1)}deg`,           // leans with the sun's direction
      '--sun-x': `${lerp(-8, 8, t).toFixed(1)}%`,
      '--sun-stretch': (1 + 0.42 * (1 - arc)).toFixed(3),           // long light early and late
      '--sun-o': (sun * (0.55 + 0.4 * Math.sqrt(arc))).toFixed(3),  // brightest at noon
      '--sun-rgb': rgb.join(' '),
      '--lamp-o': (1 - sun).toFixed(3),
    },
  };
}

/** Inline style string for the server render. */
export const daylightStyle = (d: Daylight) => Object.entries(d.vars).map(([k, v]) => `${k}:${v}`).join(';');

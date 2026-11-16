import { describe, expect, it } from 'vitest';
import { daylight, daylightStyle, istMinutes } from './daylight.ts';

const ist = (hm: string) => new Date(`2026-11-16T${hm}:00+05:30`);
const num = (v: string | undefined) => parseFloat(v ?? 'NaN');

describe('daylight', () => {
  it('reads the boutique clock in IST, whatever the server zone', () => {
    expect(istMinutes(new Date('2026-11-16T10:42:00Z'))).toBe(16 * 60 + 12);
    expect(daylight(ist('16:12')).clock).toBe('4:12 PM');
    expect(daylight(ist('00:05')).clock).toBe('12:05 AM');
  });

  it('is short, bright and upright at midday', () => {
    const d = daylight(ist('12:30')).vars;
    expect(Math.abs(num(d['--sun-skew']))).toBeLessThan(2);
    expect(num(d['--sun-stretch'])).toBeLessThan(1.01);
    expect(num(d['--sun-o'])).toBeGreaterThan(0.9);
    expect(d['--lamp-o']).toBe('0.000');
  });

  it('leans opposite ways in the morning and late afternoon, longer and warmer late', () => {
    const am = daylight(ist('08:00')).vars, pm = daylight(ist('17:00')).vars;
    expect(num(am['--sun-skew'])).toBeGreaterThan(5);
    expect(num(pm['--sun-skew'])).toBeLessThan(-5);
    expect(num(pm['--sun-stretch'])).toBeGreaterThan(1.1);
    const [, g, b] = pm['--sun-rgb']!.split(' ').map(Number);
    const [, gn, bn] = daylight(ist('12:30')).vars['--sun-rgb']!.split(' ').map(Number);
    expect(g!).toBeLessThan(gn!); // amber: less green and blue than noon
    expect(b!).toBeLessThan(bn!);
  });

  it('hands over to the lamp after dusk and before dawn', () => {
    for (const t of ['21:00', '03:00']) {
      const d = daylight(ist(t)).vars;
      expect(d['--sun-o']).toBe('0.000');
      expect(d['--lamp-o']).toBe('1.000');
    }
    const dusk = daylight(ist('18:45')).vars; // inside the crossfade
    expect(num(dusk['--sun-o'])).toBeGreaterThan(0);
    expect(num(dusk['--lamp-o'])).toBeGreaterThan(0);
  });

  it('renders as an inline style', () => {
    expect(daylightStyle(daylight(ist('12:00')))).toMatch(/^--sun-skew:[-\d.]+deg;--sun-x:/);
  });
});

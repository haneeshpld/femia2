import { describe, expect, it } from 'vitest';
import { clock, dayParts, todayKey, trialMessage, trialSig, visitDays, visitIcs } from './visit.ts';

// Mon–Sat 10 AM – 8 PM, Sunday closed (Monday-first, like the store settings).
const hours = [...Array(6)].map(() => ({ open: '10:00', close: '20:00' })).concat([{ open: '10:00', close: '20:00', closed: true }] as never);
const ist = (iso: string) => new Date(`${iso}+05:30`);

describe('visitDays', () => {
  it('offers every window early on an open day, in IST', () => {
    const [today] = visitDays(hours, ist('2026-11-16T09:00:00')); // a Monday
    expect(today!.label).toBe('Today');
    expect(today!.windows.map((w) => [w.id, w.range])).toEqual([
      ['morning', '10 AM – 12 PM'], ['afternoon', '12–4 PM'], ['evening', '4–8 PM'],
    ]);
  });

  it('starts today from the next half hour and drops windows with under an hour left', () => {
    const [today] = visitDays(hours, ist('2026-11-16T13:10:00'));
    expect(today!.windows.map((w) => [w.id, w.range])).toEqual([['afternoon', '2–4 PM'], ['evening', '4–8 PM']]);
    const late = visitDays(hours, ist('2026-11-16T18:50:00'));
    expect(late[0]!.label).toBe('Tomorrow');
  });

  it('skips closed days and labels later days by date', () => {
    const days = visitDays(hours, ist('2026-11-16T09:00:00'));
    expect(days).toHaveLength(6); // Sunday 22 Nov is closed
    expect(days.map((d) => d.label)).not.toContain('Sun 22 Nov');
    expect(days[2]!.label).toBe('Wed 18 Nov');
    expect(days[2]!.key).toBe('2026-11-18');
  });

  it('uses the IST date even when UTC is still on the previous day', () => {
    const [today] = visitDays(hours, new Date('2026-11-16T22:00:00Z')); // 3:30 AM Tuesday in Kochi
    expect(today!.key).toBe('2026-11-17');
    expect(today!.long).toBe('today, Tuesday 17 Nov');
  });

  it('falls back to plain windows without structured hours', () => {
    const days = visitDays(null, ist('2026-11-16T09:00:00'));
    expect(days).toHaveLength(7);
    expect(days[1]!.windows.every((w) => w.range === null)).toBe(true);
  });

  it('formats clock times', () => {
    expect(clock(600)).toBe('10 AM');
    expect(clock(990)).toBe('4:30 PM');
    expect(clock(720)).toBe('12 PM');
  });
});

describe('trialMessage', () => {
  it('lists each piece with its link, the visit and the name', () => {
    const [day] = visitDays(hours, ist('2026-11-16T09:00:00'));
    const msg = trialMessage({
      items: [
        { title: 'Embroidered Kurta', slug: 'embroidered-kurta', price: 249900, colour: 'Maroon', sizes: ['M'] },
        { title: 'Linen Co-ord', slug: 'linen-coord', price: 189900, colour: null, sizes: [] },
        { title: 'Anarkali Dress', slug: 'anarkali', price: 329900, colour: 'Teal', sizes: ['S', 'M', 'L'] },
      ],
      origin: 'https://femia.in', day: day!, window: day!.windows[1]!, name: '  Anu  ',
    });
    expect(msg).toContain("I'd like to try these at the boutique");
    expect(msg).toContain('1. Embroidered Kurta (Maroon, size M)');
    expect(msg).toContain('https://femia.in/products/embroidered-kurta');
    expect(msg).toContain('2. Linen Co-ord (size to check in store)');
    expect(msg).toContain('I plan to visit today, Monday 16 Nov, afternoon (12–4 PM).');
    expect(msg).toContain('3. Anarkali Dress (Teal, sizes S, M and L)');
    expect(msg).toContain('Name: Anu');
  });

  it('says when it is an update to an earlier request', () => {
    const [day] = visitDays(hours, ist('2026-11-16T09:00:00'));
    const msg = trialMessage({ items: [{ title: 'Kurta', slug: 'k', price: 100, colour: null, sizes: ['L'] }], origin: '', day: day!, window: day!.windows[0]!, update: true });
    expect(msg.startsWith('Hi Femia! An update to my try-on request:')).toBe(true);
  });
});

describe('trialSig', () => {
  it('ignores size order but notices any other change', () => {
    const a = trialSig([{ productId: 'p1', colour: 'Red', sizes: ['M', 'L'] }], '2026-11-18', 'evening');
    expect(trialSig([{ productId: 'p1', colour: 'Red', sizes: ['L', 'M'] }], '2026-11-18', 'evening')).toBe(a);
    expect(trialSig([{ productId: 'p1', colour: 'Red', sizes: ['M'] }], '2026-11-18', 'evening')).not.toBe(a);
    expect(trialSig([{ productId: 'p1', colour: 'Red', sizes: ['M', 'L'] }], '2026-11-18', 'morning')).not.toBe(a);
  });
});

describe('visit calendar', () => {
  it('splits a date key for the date tiles', () => {
    expect(dayParts('2026-11-21')).toEqual({ dow: 'Sat', date: 21, month: 'Nov' });
  });

  it('knows today in IST', () => {
    expect(todayKey(new Date('2026-11-16T22:00:00Z'))).toBe('2026-11-17');
  });

  it('builds an event in UTC from IST window minutes, with escaped, folded text', () => {
    const [day] = visitDays(hours, ist('2026-11-16T09:00:00'));
    const w = day!.windows[1]!; // 12–4 PM IST
    expect([w.from, w.to]).toEqual([720, 960]);
    const ics = visitIcs({ key: day!.key, from: w.from, to: w.to, place: 'Choice Mall, Kannur', mapUrl: 'https://maps.example/x', pieces: ['Kurta; maroon', 'Co-ord'], now: new Date('2026-11-16T03:00:00Z') });
    expect(ics).toContain('DTSTART:20261116T063000Z');
    expect(ics).toContain('DTEND:20261116T103000Z');
    expect(ics).toContain('LOCATION:Choice Mall\\, Kannur');
    expect(ics.replace(/\r\n /g, '')).toContain('DESCRIPTION:Pieces to try: Kurta\\; maroon\\, Co-ord\\nDirections: https://maps.example/x');
    expect(ics.split('\r\n').every((l) => l.length <= 61)).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
});

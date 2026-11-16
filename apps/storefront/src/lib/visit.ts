/**
 * "Try at the boutique": visit slots from the shop's opening hours (IST) and the WhatsApp message the shopper sends.
 * Pure functions, so the logic is testable and identical on server and client.
 */
import { formatINR } from '@femia/contracts/money';
import type { DayHours } from './hours.ts';
import type { TrialItem } from './stores.ts';

export type WindowId = 'morning' | 'afternoon' | 'evening';
/** `from` / `to` are minutes after midnight IST; `range` is null when the shop has no structured hours. */
export interface VisitWindow { id: WindowId; label: string; range: string | null; from: number; to: number }
export interface VisitDay { key: string; label: string; long: string; windows: VisitWindow[] }

const WINDOWS: { id: WindowId; label: string; from: number; to: number; plain: [number, number] }[] = [
  { id: 'morning', label: 'Morning', from: 0, to: 12 * 60, plain: [10 * 60, 12 * 60] },
  { id: 'afternoon', label: 'Afternoon', from: 12 * 60, to: 16 * 60, plain: [12 * 60, 16 * 60] },
  { id: 'evening', label: 'Evening', from: 16 * 60, to: 24 * 60, plain: [16 * 60, 19 * 60] },
];
const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const toMin = (hm: string) => { const [h = 0, m = 0] = hm.split(':').map(Number); return h * 60 + m; };
/** 600 → "10 AM", 990 → "4:30 PM" */
export const clock = (min: number) => {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h >= 12 ? 'PM' : 'AM'}`;
};
/** "10 AM – 12 PM", or "10–11:30 AM" when both ends share AM/PM. */
const span = (a: number, b: number) => {
  const [x, y] = [clock(a), clock(b)];
  return x.slice(-2) === y.slice(-2) ? `${x.slice(0, -3)}–${y}` : `${x} – ${y}`;
};

/**
 * Bookable days (next `count` days in IST, closed days skipped) with the windows still worth offering.
 * Today keeps a window only if at least an hour of it is left; its range then starts at the next half hour.
 * Without structured hours every day is offered with plain Morning / Afternoon / Evening.
 */
export function visitDays(hours: DayHours[] | null | undefined, now = new Date(), count = 7): VisitDay[] {
  const ist = new Date(now.getTime() + 330 * 60_000); // read with getUTC* = IST wall clock
  const nowMin = ist.getUTCHours() * 60 + ist.getUTCMinutes();
  const days: VisitDay[] = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(ist.getTime() + i * 86_400_000);
    const dow = d.getUTCDay();
    const label = i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${DAY[dow]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
    const long = `${i === 0 ? 'today, ' : i === 1 ? 'tomorrow, ' : ''}${DAY_LONG[dow]} ${d.getUTCDate()} ${MONTH[d.getUTCMonth()]}`;
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
    let windows: VisitWindow[];
    if (!hours || hours.length !== 7) {
      windows = WINDOWS.filter((w) => i > 0 || w.to - nowMin >= 60).map((w) => ({ id: w.id, label: w.label, range: null, from: w.plain[0], to: w.plain[1] }));
    } else {
      const h = hours[(dow + 6) % 7]!; // hours are Monday-first
      if (h.closed) continue;
      const open = toMin(h.open), close = toMin(h.close);
      windows = [];
      for (const w of WINDOWS) {
        let from = Math.max(w.from, open);
        const to = Math.min(w.to, close);
        if (i === 0) from = Math.max(from, Math.ceil((nowMin + 30) / 30) * 30);
        if (to - from >= 60) windows.push({ id: w.id, label: w.label, range: span(from, to), from, to });
      }
    }
    if (windows.length) days.push({ key, label, long, windows });
  }
  return days;
}

/** Parts for a date tile: "Sat", 21, "Nov". */
export function dayParts(key: string) {
  const [y, m, d] = key.split('-').map(Number);
  const dt = new Date(Date.UTC(y!, m! - 1, d!));
  return { dow: DAY[dt.getUTCDay()]!, date: d!, month: MONTH[m! - 1]! };
}

/** Today's date in IST as YYYY-MM-DD (same format as VisitDay.key). */
export const todayKey = (now = new Date()) => new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);

/** "M", "M and L", "S, M and L" */
const andList = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

type MsgItem = Pick<TrialItem, 'title' | 'slug' | 'price' | 'colour' | 'sizes'>;

/** Fingerprint of a request, to tell whether the list or time changed since it was sent. */
export const trialSig = (items: Pick<TrialItem, 'productId' | 'colour' | 'sizes'>[], dayKey: string, win: WindowId) =>
  [dayKey, win, ...items.map((i) => `${i.productId}:${i.colour ?? ''}:${[...i.sizes].sort().join('+')}`)].join('|');

/** The WhatsApp message: one line per piece with its link, then the visit and the shopper's name. */
export function trialMessage({ items, origin, day, window, name, update = false }: {
  items: MsgItem[]; origin: string; day: VisitDay; window: VisitWindow; name?: string; update?: boolean;
}): string {
  const lines = items.map((it, n) => {
    const size = it.sizes.length === 0 ? 'size to check in store' : `${it.sizes.length > 1 ? 'sizes' : 'size'} ${andList(it.sizes)}`;
    const opts = [it.colour, size].filter(Boolean).join(', ');
    return `${n + 1}. ${it.title} (${opts}) · ${formatINR(it.price)}\n   ${origin}/products/${it.slug}`;
  });
  const when = `${window.label.toLowerCase()}${window.range ? ` (${window.range})` : ''}`;
  return [
    update ? 'Hi Femia! An update to my try-on request:' : `Hi Femia! I'd like to try ${items.length === 1 ? 'this' : 'these'} at the boutique:`,
    '',
    ...lines,
    '',
    `I plan to visit ${day.long}, ${when}.`,
    ...(name?.trim() ? [`Name: ${name.trim().slice(0, 60)}`] : []),
    '',
    'Could you keep them ready for me? Thank you!',
  ].join('\n');
}

/** iCalendar text escaping and line folding (RFC 5545). */
const icsText = (v: string) => v.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
const fold = (line: string) => line.match(/.{1,60}/gu)!.join('\r\n ');
const icsDate = (key: string, min: number) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!) + (min - 330) * 60_000).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
};

/** A calendar event for the visit, in UTC, so it lands at the right time on any phone. */
export function visitIcs({ key, from, to, place, mapUrl, pieces, now = new Date() }: {
  key: string; from: number; to: number; place: string; mapUrl?: string; pieces: string[]; now?: Date;
}): string {
  const description = [`Pieces to try: ${pieces.join(', ')}`, mapUrl ? `Directions: ${mapUrl}` : ''].filter(Boolean).join('\n');
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Femia//Try-on visit//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:try-on-${key}-${from}@femia`,
    `DTSTAMP:${now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${icsDate(key, from)}`,
    `DTEND:${icsDate(key, to)}`,
    `SUMMARY:${icsText('Try-on at Femia')}`,
    ...(place ? [`LOCATION:${icsText(place)}`] : []),
    `DESCRIPTION:${icsText(description)}`,
    'BEGIN:VALARM', 'ACTION:DISPLAY', 'DESCRIPTION:Try-on at Femia', 'TRIGGER:-PT2H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR',
  ].map(fold).join('\r\n') + '\r\n';
}

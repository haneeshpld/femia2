import type { Paise } from './common.ts';

export const rupees = (r: number): Paise => Math.round(r * 100);

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const inr2 = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });

/** "₹1,299" (drops paise when they are zero). */
export function formatINR(p: Paise): string {
  return p % 100 === 0 ? inr.format(p / 100) : inr2.format(p / 100);
}

/** Whole-number percentage saved, e.g. 28 for 1299 vs 1799. */
export function percentOff(price: Paise, compareAt: Paise | null | undefined): number {
  if (!compareAt || compareAt <= price) return 0;
  return Math.round(((compareAt - price) / compareAt) * 100);
}

/** upi://pay deep link. Amount in rupees with 2 decimals, as UPI apps expect. */
export function upiUri(o: { vpa: string; payee: string; amount: Paise; number: string }) {
  const p = new URLSearchParams({ pa: o.vpa, pn: o.payee, am: (o.amount / 100).toFixed(2), cu: 'INR', tn: `Femia order ${o.number}`, tr: o.number });
  return `upi://pay?${p.toString().replace(/\+/g, '%20')}`;
}

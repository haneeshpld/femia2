import { z } from 'zod';
import { Id, Paise } from './common.ts';
import type { Paise as PaiseT } from './common.ts';

/**
 * Offers. Four kinds, one table:
 *  • sale   – automatic % or ₹ off products in scope; best single sale per item (no stacking)
 *  • bundle – automatic cart deal when enough pieces / value from the scope are in the bag; best single bundle
 *  • coupon – code typed at checkout; applies on top of sale prices (and bundles)
 *  • tag    – a label on products in scope ("Bestseller"), no price change
 * All maths here is pure and shared, so the bag, checkout and the order always agree.
 */
export const OfferKind = z.enum(['sale', 'bundle', 'coupon', 'tag']);
export type OfferKind = z.infer<typeof OfferKind>;
export const OfferStyle = z.enum(['maroon', 'gold', 'ink', 'rose', 'green']);
export type OfferStyle = z.infer<typeof OfferStyle>;
export const OfferScope = z.enum(['all', 'products', 'categories', 'collections']);

export interface Offer {
  id: string; kind: OfferKind; name: string; label: string; style: OfferStyle; code: string | null;
  discountType: 'percent' | 'amount'; value: number; maxDiscount: PaiseT | null;
  scope: z.infer<typeof OfferScope>; scopeIds: string[];
  minQty: number; minSubtotal: PaiseT; firstOrderOnly: boolean;
  usageLimit: number | null; perCustomerLimit: number | null; usedCount: number;
  startsAt: string | null; endsAt: string | null; active: boolean;
}

const when = z.string().datetime({ offset: true }).nullable().default(null);
export const OfferInput = z.object({
  kind: OfferKind,
  name: z.string().trim().min(2, 'Give the offer a name').max(60),
  label: z.string().trim().max(28, 'Keep the tag short (28 characters)').default(''),
  style: OfferStyle.default('maroon'),
  code: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{3,20}$/, 'Codes use 3–20 letters or numbers').nullable().default(null),
  discountType: z.enum(['percent', 'amount']).default('percent'),
  value: z.number().int().min(0).default(0),
  maxDiscount: Paise.nullable().default(null),
  scope: OfferScope.default('all'),
  scopeIds: z.array(Id).max(200).default([]),
  minQty: z.number().int().min(0).max(50).default(0),
  minSubtotal: Paise.default(0),
  firstOrderOnly: z.boolean().default(false),
  usageLimit: z.number().int().min(1).nullable().default(null),
  perCustomerLimit: z.number().int().min(1).nullable().default(null),
  startsAt: when,
  endsAt: when,
  active: z.boolean().default(true),
}).superRefine((o, ctx) => {
  const issue = (path: string, message: string) => ctx.addIssue({ code: 'custom', path: [path], message });
  if (o.kind !== 'tag') {
    if (o.value <= 0) issue('value', 'Enter the discount');
    if (o.discountType === 'percent' && o.value > 90) issue('value', 'Percent discounts go up to 90%');
  }
  if (o.kind === 'coupon' && !o.code) issue('code', 'Enter a code customers will type');
  if (o.kind !== 'coupon' && o.code) issue('code', 'Only coupons have a code');
  if ((o.kind === 'sale' || o.kind === 'tag') && !o.label) issue('label', 'Enter the tag shoppers will see');
  if (o.kind === 'bundle' && o.minQty === 0 && o.minSubtotal === 0) issue('minQty', 'Set a minimum number of pieces or a minimum order value');
  if (o.scope !== 'all' && o.scopeIds.length === 0) issue('scopeIds', 'Choose at least one');
  if (o.startsAt && o.endsAt && Date.parse(o.endsAt) <= Date.parse(o.startsAt)) issue('endsAt', 'The end must be after the start');
});
export type OfferInput = z.input<typeof OfferInput>;

export type OfferStatus = 'live' | 'scheduled' | 'ended' | 'paused' | 'used-up';
export function offerStatus(o: Pick<Offer, 'active' | 'startsAt' | 'endsAt' | 'usageLimit' | 'usedCount'>, now = Date.now()): OfferStatus {
  if (!o.active) return 'paused';
  if (o.endsAt && Date.parse(o.endsAt) <= now) return 'ended';
  if (o.usageLimit !== null && o.usedCount >= o.usageLimit) return 'used-up';
  if (o.startsAt && Date.parse(o.startsAt) > now) return 'scheduled';
  return 'live';
}
export const isLive = (o: Offer, now = Date.now()) => offerStatus(o, now) === 'live';

/** What a product line needs for scope checks. */
export interface ScopeItem { productId: string; categoryId: string; collectionIds: string[] }
export function inScope(o: Pick<Offer, 'scope' | 'scopeIds'>, item: ScopeItem) {
  switch (o.scope) {
    case 'all': return true;
    case 'products': return o.scopeIds.includes(item.productId);
    case 'categories': return o.scopeIds.includes(item.categoryId);
    case 'collections': return item.collectionIds.some((c) => o.scopeIds.includes(c));
  }
}

const roundRupee = (p: number) => Math.round(p / 100) * 100;
function discountOn(base: PaiseT, o: Offer): PaiseT {
  let d = o.discountType === 'percent' ? roundRupee((base * o.value) / 100) : o.value;
  if (o.maxDiscount !== null) d = Math.min(d, o.maxDiscount);
  return Math.max(0, Math.min(d, base));
}

/** Best automatic sale for one product at its list price. */
export function bestSale(listPrice: PaiseT, item: ScopeItem, offers: Offer[], now = Date.now()): { price: PaiseT; offer: Offer } | null {
  let best: { price: PaiseT; offer: Offer } | null = null;
  for (const o of offers) {
    if (o.kind !== 'sale' || !isLive(o, now) || !inScope(o, item)) continue;
    const price = listPrice - discountOn(listPrice, o);
    if (price < listPrice && (!best || price < best.price)) best = { price, offer: o };
  }
  return best;
}

/** Price-neutral tags for one product. */
export const tagsFor = (item: ScopeItem, offers: Offer[], now = Date.now()) =>
  offers.filter((o) => o.kind === 'tag' && isLive(o, now) && inScope(o, item)).map((o) => ({ label: o.label, style: o.style }));

export const offerValueText = (o: Pick<Offer, 'discountType' | 'value'>) => (o.discountType === 'percent' ? `${o.value}% off` : `₹${(o.value / 100).toLocaleString('en-IN')} off`);

/** Shopper-facing description of a bundle rule, e.g. "Buy 2, get 10% off". */
export function bundleText(o: Offer) {
  const v = offerValueText(o);
  if (o.minQty > 0 && o.minSubtotal > 0) return `Buy ${o.minQty} above ₹${(o.minSubtotal / 100).toLocaleString('en-IN')}, get ${v}`;
  if (o.minQty > 0) return `Buy ${o.minQty}, get ${v}`;
  return `${v.replace(' off', '')} off above ₹${(o.minSubtotal / 100).toLocaleString('en-IN')}`;
}

export interface CartLineForOffers { qty: number; lineTotal: PaiseT; scope: ScopeItem }
export interface AppliedDiscount { offerId: string; kind: 'bundle' | 'coupon'; label: string; code: string | null; amount: PaiseT }

/**
 * Cart-level deals after sale prices: the best qualifying bundle, then the coupon (already validated by the server
 * for usage limits / first order). Also returns a nudge towards the closest bundle not yet reached.
 */
export function cartDiscounts(lines: CartLineForOffers[], offers: Offer[], coupon: Offer | null, now = Date.now()) {
  const applied: AppliedDiscount[] = [];
  const subtotal = lines.reduce((s, l) => s + l.lineTotal, 0);
  const eligible = (o: Offer) => {
    const ls = lines.filter((l) => inScope(o, l.scope));
    return { qty: ls.reduce((n, l) => n + l.qty, 0), value: ls.reduce((n, l) => n + l.lineTotal, 0) };
  };

  let best: AppliedDiscount | null = null;
  let nudge: { text: string; gap: number } | null = null;
  for (const o of offers) {
    if (o.kind !== 'bundle' || !isLive(o, now)) continue;
    const e = eligible(o);
    if (e.qty >= o.minQty && e.value >= o.minSubtotal && e.value > 0) {
      const amount = discountOn(e.value, o);
      if (!best || amount > best.amount) best = { offerId: o.id, kind: 'bundle', label: o.label || bundleText(o), code: null, amount };
    } else if (subtotal > 0) {
      const what = o.label || offerValueText(o);
      const pieces = Math.max(0, o.minQty - e.qty);
      const rupees = Math.max(0, o.minSubtotal - e.value);
      const text = pieces > 0 ? `Add ${pieces} more piece${pieces > 1 ? 's' : ''} to get ${what}` : `Add ₹${Math.ceil(rupees / 100).toLocaleString('en-IN')} more to get ${what}`;
      const gap = pieces > 0 ? pieces * 1e7 : rupees; // prefer the closest money gap, then fewest pieces
      if (!nudge || gap < nudge.gap) nudge = { text, gap };
    }
  }
  if (best) applied.push(best);

  let couponError: string | null = null;
  if (coupon) {
    const e = eligible(coupon);
    if (subtotal < coupon.minSubtotal) couponError = `Add ₹${Math.ceil((coupon.minSubtotal - subtotal) / 100).toLocaleString('en-IN')} more to use ${coupon.code}`;
    else if (e.value === 0) couponError = `${coupon.code} doesn't apply to the items in your bag`;
    else {
      const room = subtotal - applied.reduce((s, a) => s + a.amount, 0);
      const amount = Math.min(discountOn(e.value, coupon), room);
      if (amount > 0) applied.push({ offerId: coupon.id, kind: 'coupon', label: coupon.label || 'Offer code', code: coupon.code, amount });
    }
  }
  const total = applied.reduce((s, a) => s + a.amount, 0);
  return { applied, discountTotal: total, nudge: best ? null : nudge?.text ?? null, couponError };
}

export const CouponCheck = z.object({ code: z.string().trim().toUpperCase().max(20) });

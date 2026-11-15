import { describe, expect, it } from 'vitest';
import { bestSale, bundleText, cartDiscounts, offerStatus, OfferInput, quoteCart, tagsFor, type Offer, type PricedVariant } from '../src/index.ts';

const now = Date.parse('2026-11-15T10:00:00Z');
const offer = (o: Partial<Offer>): Offer => ({
  id: 'o', kind: 'sale', name: 'n', label: 'Sale', style: 'maroon', code: null, discountType: 'percent', value: 20, maxDiscount: null,
  scope: 'all', scopeIds: [], minQty: 0, minSubtotal: 0, firstOrderOnly: false, usageLimit: null, perCustomerLimit: null, usedCount: 0,
  startsAt: null, endsAt: null, active: true, ...o,
});
const kurta = { productId: 'p1', categoryId: 'cat_kurtas', collectionIds: ['col_festive'] };
const dress = { productId: 'p2', categoryId: 'cat_dresses', collectionIds: [] };

describe('sales', () => {
  it('takes the best single sale, rounded to the rupee', () => {
    const r = bestSale(129900, kurta, [offer({ id: 'a', value: 20 }), offer({ id: 'b', scope: 'categories', scopeIds: ['cat_kurtas'], discountType: 'amount', value: 30000 })], now);
    expect(r).toMatchObject({ price: 99900, offer: { id: 'b' } });
    expect(bestSale(129900, kurta, [offer({ value: 15 })], now)?.price).toBe(110400); // 19485 → 19500 off
  });
  it('respects scope, schedule, pause and caps', () => {
    expect(bestSale(129900, dress, [offer({ scope: 'collections', scopeIds: ['col_festive'] })], now)).toBeNull();
    expect(bestSale(129900, kurta, [offer({ startsAt: '2026-11-20T00:00:00Z' })], now)).toBeNull();
    expect(bestSale(129900, kurta, [offer({ endsAt: '2026-11-01T00:00:00Z' })], now)).toBeNull();
    expect(bestSale(129900, kurta, [offer({ active: false })], now)).toBeNull();
    expect(bestSale(129900, kurta, [offer({ value: 50, maxDiscount: 20000 })], now)?.price).toBe(109900);
  });
  it('tags never change price', () => {
    expect(tagsFor(kurta, [offer({ kind: 'tag', label: 'Bestseller', style: 'gold' })], now)).toEqual([{ label: 'Bestseller', style: 'gold' }]);
    expect(bestSale(129900, kurta, [offer({ kind: 'tag' })], now)).toBeNull();
  });
});

describe('bundles and coupons', () => {
  const lines = [{ qty: 1, lineTotal: 129900, scope: kurta }, { qty: 1, lineTotal: 169900, scope: dress }];
  it('applies the best qualifying bundle and nudges toward the next', () => {
    const buy2 = offer({ id: 'b2', kind: 'bundle', label: '', minQty: 2, value: 10 });
    const buy3 = offer({ id: 'b3', kind: 'bundle', label: '', minQty: 3, value: 20 });
    const r = cartDiscounts(lines, [buy2, buy3], null, now);
    expect(r.applied).toEqual([{ offerId: 'b2', kind: 'bundle', label: 'Buy 2, get 10% off', code: null, amount: 30000 }]);
    expect(r.nudge).toBeNull();
    const one = cartDiscounts([lines[0]!], [buy2], null, now);
    expect(one.applied).toEqual([]);
    expect(one.nudge).toBe('Add 1 more piece to get 10% off');
  });
  it('value bundles count only items in scope', () => {
    const r = cartDiscounts(lines, [offer({ kind: 'bundle', label: 'Kurta deal', scope: 'categories', scopeIds: ['cat_kurtas'], minSubtotal: 200000, discountType: 'amount', value: 20000 })], null, now);
    expect(r.applied).toEqual([]);
    expect(r.nudge).toBe('Add ₹701 more to get Kurta deal');
  });
  it('coupons stack after bundles but never exceed the bag', () => {
    const c = offer({ id: 'c', kind: 'coupon', code: 'FEMIA10', label: '', value: 10 });
    const r = cartDiscounts(lines, [offer({ kind: 'bundle', minQty: 2, value: 10 })], c, now);
    expect(r.applied.map((a) => [a.kind, a.amount])).toEqual([['bundle', 30000], ['coupon', 30000]]);
    const big = cartDiscounts([lines[0]!], [], offer({ kind: 'coupon', code: 'BIG', discountType: 'amount', value: 999999 }), now);
    expect(big.discountTotal).toBe(129900);
  });
  it('explains coupon minimums', () => {
    const r = cartDiscounts([lines[0]!], [], offer({ kind: 'coupon', code: 'FEST', minSubtotal: 200000 }), now);
    expect(r.couponError).toBe('Add ₹701 more to use FEST');
    expect(r.applied).toEqual([]);
  });
});

describe('quote with offers', () => {
  const v = (id: string, price: number, scope = kurta): PricedVariant => ({
    variantId: id, productId: scope.productId, slug: 's', title: 'T', option1: 'M', option2: null, optionLabel: 'M', imageUrl: null,
    price, compareAtPrice: null, available: 5, purchasable: true, listPrice: 129900, scope,
  });
  it('free shipping is judged after discounts, totals add up', () => {
    const map = new Map([['a', v('a', 103900)]]);
    const q = quoteCart([{ variantId: 'a', qty: 1 }], map, { freeShippingThreshold: 99900, flatFee: 7900 }, {
      offers: [], coupon: offer({ kind: 'coupon', code: 'FEMIA10', label: '', value: 10 }), couponCode: 'FEMIA10', now,
    });
    expect(q).toMatchObject({ subtotal: 103900, discountTotal: 10400, shipping: 7900, total: 101400, savings: 26000 + 10400 });
    expect(q.coupon).toEqual({ code: 'FEMIA10', applied: true, message: 'FEMIA10 applied' });
  });
});

describe('admin input & status', () => {
  it('validates per kind', () => {
    expect(OfferInput.safeParse({ kind: 'coupon', name: 'Welcome', value: 10 }).success).toBe(false);
    expect(OfferInput.safeParse({ kind: 'coupon', name: 'Welcome', value: 10, code: 'femia10' }).data?.code).toBe('FEMIA10');
    expect(OfferInput.safeParse({ kind: 'bundle', name: 'B', value: 10 }).success).toBe(false);
    expect(OfferInput.safeParse({ kind: 'tag', name: 'Best', label: 'Bestseller' }).success).toBe(true);
    expect(OfferInput.safeParse({ kind: 'sale', name: 'S', label: 'Sale', value: 95 }).success).toBe(false);
  });
  it('reports status', () => {
    expect(offerStatus(offer({ usageLimit: 5, usedCount: 5 }), now)).toBe('used-up');
    expect(offerStatus(offer({ startsAt: '2026-12-01T00:00:00Z' }), now)).toBe('scheduled');
    expect(bundleText(offer({ kind: 'bundle', minSubtotal: 299900, discountType: 'amount', value: 20000 }))).toBe('₹200 off above ₹2,999');
  });
});

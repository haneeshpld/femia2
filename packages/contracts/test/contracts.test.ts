import { describe, expect, it } from 'vitest';
import { canShipTo, formatINR, percentOff, quoteCart, stateForPincode, Phone, Settings, type PricedVariant } from '../src/index.ts';

const v = (id: string, price: number, available: number, extra: Partial<PricedVariant> = {}): PricedVariant => ({
  variantId: id, productId: 'p', slug: 's', title: 'T', option1: 'M', option2: 'maroon', optionLabel: 'M / Maroon',
  imageUrl: null, price, compareAtPrice: null, available, purchasable: true, ...extra,
});
const ship = { freeShippingThreshold: 99900, flatFee: 7900 };

describe('money', () => {
  it('formats INR without paise', () => expect(formatINR(129900)).toBe('₹1,299'));
  it('formats lakh grouping', () => expect(formatINR(12345600)).toBe('₹1,23,456'));
  it('percent off', () => expect(percentOff(129900, 179900)).toBe(28));
  it('no percent when compare-at missing or lower', () => {
    expect(percentOff(129900, null)).toBe(0);
    expect(percentOff(129900, 100000)).toBe(0);
  });
});

describe('quoteCart', () => {
  const map = new Map([['a', v('a', 129900, 5, { compareAtPrice: 179900 })], ['b', v('b', 49900, 1)], ['c', v('c', 10000, 0)], ['d', v('d', 10000, 3, { purchasable: false })]]);

  it('charges flat shipping below threshold', () => {
    const q = quoteCart([{ variantId: 'b', qty: 1 }], map, ship);
    expect(q).toMatchObject({ subtotal: 49900, shipping: 7900, total: 57800, freeShippingRemaining: 50000 });
  });
  it('free shipping at or above threshold', () => {
    const q = quoteCart([{ variantId: 'a', qty: 1 }], map, ship);
    expect(q).toMatchObject({ subtotal: 129900, shipping: 0, total: 129900, savings: 50000, freeShippingRemaining: 0 });
  });
  it('merges duplicate lines and clamps to stock', () => {
    const q = quoteCart([{ variantId: 'b', qty: 1 }, { variantId: 'b', qty: 2 }], map, ship);
    expect(q.lines[0]?.qty).toBe(1);
    expect(q.issues).toEqual([{ variantId: 'b', code: 'reduced', requested: 3, available: 1 }]);
  });
  it('drops sold out, unavailable and unknown variants', () => {
    const q = quoteCart([{ variantId: 'c', qty: 1 }, { variantId: 'd', qty: 1 }, { variantId: 'zzz', qty: 1 }], map, ship);
    expect(q.lines).toHaveLength(0);
    expect(q.shipping).toBe(0);
    expect(q.issues.map((i) => i.code)).toEqual(['sold_out', 'unavailable', 'unavailable']);
  });
  it('ignores client-supplied prices entirely', () => {
    const q = quoteCart([{ variantId: 'a', qty: 2, price: 1 } as never], map, ship);
    expect(q.subtotal).toBe(259800);
  });
});

describe('shipping', () => {
  it('Kerala pincodes', () => {
    expect(stateForPincode('682001')).toBe('KL'); // Kochi
    expect(stateForPincode('695001')).toBe('KL'); // Thiruvananthapuram
    expect(stateForPincode('670001')).toBe('KL'); // Kannur
  });
  it('rejects Lakshadweep, other states and junk', () => {
    expect(stateForPincode('682555')).toBeNull();
    expect(stateForPincode('560001')).toBeNull();
    expect(stateForPincode('012345')).toBeNull();
    expect(stateForPincode('abc')).toBeNull();
  });
  it('respects ship-to setting', () => {
    expect(canShipTo('682001', ['KL'])).toBe(true);
    expect(canShipTo('600001', ['KL'])).toBe(false);
  });
});

describe('phone', () => {
  it('normalises prefixes', () => {
    expect(Phone.parse('+91 98470 12345')).toBe('9847012345');
    expect(Phone.parse('09847012345')).toBe('9847012345');
  });
  it('rejects bad numbers', () => expect(Phone.safeParse('12345').success).toBe(false));
});

describe('settings defaults', () => {
  it('fills a complete default settings object', () => {
    const s = Settings.parse({});
    expect(s.shipping.freeShippingThreshold).toBe(99900);
    expect(s.shipping.shipToStates).toEqual(['KL']);
    expect(s.payments.gateway.enabled).toBe(false);
    expect(s.shipping.cod.enabled).toBe(true);
  });
});

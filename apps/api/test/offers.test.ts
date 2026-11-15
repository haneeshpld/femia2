import { beforeEach, describe, expect, it } from 'vitest';
import { call, checkout, seedBasics, seedProduct } from './helpers.ts';

beforeEach(seedBasics);

const offer = async (body: Record<string, unknown>) => {
  const r = await call('POST', '/admin/offers', body);
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return r.json as { id: string; status: string };
};
const two = (v: string) => [{ variantId: v, qty: 2 }];

describe('offers', () => {
  it('a sale lowers the card price, shows its tag and is what the order charges', async () => {
    const { productId, slug, variantIds: [v] } = await seedProduct([5], 129900);
    await offer({ kind: 'sale', name: 'Onam sale', label: 'Onam Sale', style: 'gold', value: 20, scope: 'products', scopeIds: [productId] });

    const list = await call('GET', '/catalog/products?category=kurtas&pageSize=48');
    const card = list.json.items.find((p: { slug: string }) => p.slug === slug);
    expect(card).toMatchObject({ price: 103900, compareAtPrice: 129900 }); // 20% of ₹1,299 → ₹260 off
    expect(card.badges).toContainEqual({ label: 'Onam Sale', style: 'gold', kind: 'sale' });

    const pdp = await call('GET', `/catalog/products/${slug}`);
    expect(pdp.json.variants[0].price).toBe(103900);

    const r = await call('POST', '/orders', checkout(v!, 'cod'));
    expect(r.json.order).toMatchObject({ subtotal: 103900 });
    expect(r.json.order.items[0].unitPrice ?? r.json.order.items[0].price).toBe(103900);
  });

  it('a bundle nudges, then applies, and the order keeps the discount line', async () => {
    const { productId, variantIds: [v] } = await seedProduct([5], 129900);
    await offer({ kind: 'bundle', name: 'Pair up', label: 'Buy 2, save 10%', value: 10, minQty: 2, scope: 'products', scopeIds: [productId] });

    const one = await call('POST', '/cart/quote', { lines: [{ variantId: v, qty: 1 }] });
    expect(one.json.nudge).toBe('Add 1 more piece to get Buy 2, save 10%');
    expect(one.json.discountTotal).toBe(0);

    const q = await call('POST', '/cart/quote', { lines: two(v!) });
    expect(q.json.discounts).toEqual([expect.objectContaining({ kind: 'bundle', amount: 26000 })]);
    expect(q.json.total).toBe(259800 - 26000 + q.json.shipping);

    const r = await call('POST', '/orders', { ...checkout(v!, 'cod'), lines: two(v!) });
    expect(r.json.order).toMatchObject({ subtotal: 259800, discount: 26000, total: 259800 - 26000 + r.json.order.shipping });
    expect(r.json.order.discounts).toEqual([{ label: 'Buy 2, save 10%', code: null, amount: 26000 }]);
  });

  it('a coupon applies, counts a use, refuses once used up and comes back when the order is cancelled', async () => {
    const { variantIds: [v] } = await seedProduct([5], 129900);
    await offer({ kind: 'coupon', name: 'Welcome', code: 'welcome200', discountType: 'amount', value: 20000, usageLimit: 1 });

    const q = await call('POST', '/cart/quote', { lines: [{ variantId: v, qty: 1 }], coupon: 'WELCOME200' });
    expect(q.json.coupon).toMatchObject({ code: 'WELCOME200', applied: true });
    expect(q.json.discountTotal).toBe(20000);

    const first = await call('POST', '/orders', checkout(v!, 'cod', { coupon: 'welcome200' }));
    expect(first.status).toBe(201);
    expect(first.json.order).toMatchObject({ discount: 20000, discounts: [{ code: 'WELCOME200', amount: 20000 }] });

    const again = await call('POST', '/orders', checkout(v!, 'cod', { coupon: 'WELCOME200', customer: { name: 'Mini', phone: '9847099999', email: 'm@example.com' } }));
    expect(again.status).toBe(422);
    expect(again.json.error).toMatchObject({ code: 'coupon_invalid', message: 'WELCOME200 has been fully used' });

    const list = await call('GET', '/admin/offers');
    expect(list.json.find((o: { code: string }) => o.code === 'WELCOME200')).toMatchObject({ usedCount: 1, status: 'used-up', orders: 1, discountGiven: 20000 });

    const cancel = await call('POST', `/admin/orders/${first.json.order.number}/transition`, { to: 'cancelled', reason: 'Customer changed mind' });
    expect(cancel.status).toBe(200);
    const after = await call('GET', '/admin/offers');
    expect(after.json.find((o: { code: string }) => o.code === 'WELCOME200')).toMatchObject({ usedCount: 0, status: 'live' });
  });

  it('checks codes: unknown, minimum value and first order only', async () => {
    const { variantIds: [v] } = await seedProduct([5], 49900);
    await offer({ kind: 'coupon', name: 'Big bag', code: 'BIG500', discountType: 'amount', value: 50000, minSubtotal: 300000 });
    await offer({ kind: 'coupon', name: 'First', code: 'FIRST10', value: 10, firstOrderOnly: true });

    const unknown = await call('POST', '/cart/quote', { lines: [{ variantId: v, qty: 1 }], coupon: 'NOPE' });
    expect(unknown.json.coupon).toMatchObject({ applied: false, message: "NOPE isn't a valid code" });
    expect(unknown.json.total).toBe(49900 + unknown.json.shipping);

    const small = await call('POST', '/cart/quote', { lines: [{ variantId: v, qty: 1 }], coupon: 'BIG500' });
    expect(small.json.coupon.message).toBe('Add ₹2,501 more to use BIG500');

    expect((await call('POST', '/orders', checkout(v!, 'cod'))).status).toBe(201); // this phone has ordered before
    const repeat = await call('POST', '/cart/quote', { lines: [{ variantId: v, qty: 1 }], coupon: 'FIRST10', phone: '9847012345' });
    expect(repeat.json.coupon).toMatchObject({ applied: false, message: 'FIRST10 is for first orders only' });
    const bad = await call('POST', '/orders', checkout(v!, 'cod', { coupon: 'NOPE' }));
    expect(bad.status).toBe(422);
  });

  it('tags show without changing the price; only the owner manages offers', async () => {
    const { productId, slug } = await seedProduct([5], 129900);
    await offer({ kind: 'tag', name: 'Best', label: 'Bestseller', style: 'ink', scope: 'products', scopeIds: [productId] });
    const list = await call('GET', '/catalog/products?category=kurtas&pageSize=48');
    expect(list.json.items.find((p: { slug: string }) => p.slug === slug)).toMatchObject({ price: 129900, badges: [{ label: 'Bestseller', style: 'ink', kind: 'tag' }] });

    const staff = { 'X-Dev-User': 'staff@test.local' };
    expect((await call('POST', '/admin/offers', { kind: 'tag', name: 'Staff tag', label: 'New' }, staff)).status).toBe(403);
    expect((await call('GET', '/admin/offers', undefined, staff)).status).toBe(200);

    const noCode = await call('POST', '/admin/offers', { kind: 'coupon', name: 'Oops', value: 10 });
    expect(noCode.status).toBe(422);
    const dup = await call('POST', '/admin/offers', { kind: 'coupon', name: 'Alpha', code: 'SAME1', value: 10 });
    expect(dup.status).toBe(201);
    expect((await call('POST', '/admin/offers', { kind: 'coupon', name: 'Beta', code: 'same1', value: 5 })).status).toBe(409);
  });
});

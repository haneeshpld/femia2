import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { call, checkout, E, expireHolds, seedBasics, seedProduct, variant } from './helpers.ts';
import { releaseExpiredHolds } from '../src/services/orders.ts';
import { hmacSha256Hex } from '../src/lib/crypto.ts';
import { putGatewayKeysStatement } from '../src/payments/index.ts';

const runCron = async () => { const ctx = createExecutionContext(); const n = await releaseExpiredHolds(E, ctx); await waitOnExecutionContext(ctx); return n; };

beforeEach(seedBasics);

describe('acceptance 3: the last unit', () => {
  it('two customers cannot buy the same last item', async () => {
    const { variantIds: [v], slug } = await seedProduct([1]);
    const results = await Promise.all(Array.from({ length: 6 }, () => call('POST', '/orders', checkout(v!, 'cod'))));
    expect(results.filter((r) => r.status === 201)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409).every((r) => r.json.error.code === 'cart_changed')).toBe(true);
    expect(await variant(v!)).toEqual({ on_hand: 0, reserved: 0 });
    const list = await call('GET', '/catalog/products?category=kurtas&pageSize=48');
    expect(list.json.items.find((p: { slug: string }) => p.slug === slug).soldOut).toBe(true);
  });

  it('a held unit is not sellable to anyone else', async () => {
    const { variantIds: [v] } = await seedProduct([1]);
    expect((await call('POST', '/orders', checkout(v!, 'upi'))).status).toBe(201);
    expect(await variant(v!)).toEqual({ on_hand: 1, reserved: 1 });
    const second = await call('POST', '/orders', checkout(v!, 'cod'));
    expect(second.status).toBe(409);
  });

  it('server ignores client prices and recomputes totals', async () => {
    const { variantIds: [v] } = await seedProduct([3], 49900);
    const r = await call('POST', '/orders', { ...checkout(v!, 'cod'), lines: [{ variantId: v, qty: 1, price: 1 }], total: 1 });
    expect(r.json.order).toMatchObject({ subtotal: 49900, shipping: 7900, total: 57800 });
  });
});

describe('UPI and holds', () => {
  it('acceptance 4: UPI order → staff marks paid → stock committed', async () => {
    const { variantIds: [v] } = await seedProduct([2]);
    const r = await call('POST', '/orders', checkout(v!, 'upi'));
    expect(r.json.order.status).toBe('pending_payment');
    expect(r.json.next.upiUri).toContain('am=1299.00');
    const paid = await call('POST', `/admin/orders/${r.json.order.number}/mark-paid`, undefined, { 'X-Dev-User': 'staff@test.local' });
    expect(paid.json).toMatchObject({ status: 'new', paymentStatus: 'paid' });
    expect(await variant(v!)).toEqual({ on_hand: 1, reserved: 0 });
  });

  it('expired holds are released and the order cancelled', async () => {
    const { variantIds: [v] } = await seedProduct([1]);
    const r = await call('POST', '/orders', checkout(v!, 'upi'));
    await expireHolds();
    expect(await runCron()).toBeGreaterThanOrEqual(1);
    expect(await variant(v!)).toEqual({ on_hand: 1, reserved: 0 });
    const track = await call('POST', '/orders/track', { number: r.json.order.number, phone: '9847012345' });
    expect(track.json.status).toBe('cancelled');
  });

  it('payment after expiry re-sells if stock remains, flags if sold out', async () => {
    const { variantIds: [v] } = await seedProduct([1]);
    const a = await call('POST', '/orders', checkout(v!, 'upi'));
    await expireHolds(); await runCron();
    // someone else buys the unit, then the late UPI payment is marked
    expect((await call('POST', '/orders', checkout(v!, 'cod'))).status).toBe(201);
    const late = await call('POST', `/admin/orders/${a.json.order.number}/mark-paid`);
    expect(late.json.paymentStatus).toBe('paid');
    const detail = await call('GET', `/admin/orders/${a.json.order.number}`);
    expect(detail.json.notes).toContain('Refund or offer a substitute');
    expect(await variant(v!)).toEqual({ on_hand: 0, reserved: 0 });
  });

  it('cancelling a COD order puts stock back', async () => {
    const { variantIds: [v] } = await seedProduct([2]);
    const r = await call('POST', '/orders', checkout(v!, 'cod'));
    expect(await variant(v!)).toEqual({ on_hand: 1, reserved: 0 });
    await call('POST', `/admin/orders/${r.json.order.number}/transition`, { to: 'cancelled', reason: 'Customer changed mind' });
    expect(await variant(v!)).toEqual({ on_hand: 2, reserved: 0 });
  });
});

describe('acceptance 5: gateway (Razorpay test mode)', () => {
  const keys = { keyId: 'rzp_test_123', keySecret: 'secret_abc', webhookSecret: 'whsec_xyz' };
  let rzpOrder = 0;
  beforeEach(async () => {
    await (await putGatewayKeysStatement(E, 'razorpay', keys, 'test')).run();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
      if (String(input instanceof Request ? input.url : input).startsWith('https://api.razorpay.com/v1/orders')) {
        return Response.json({ id: `order_rzp${++rzpOrder}` });
      }
      throw new Error(`unexpected fetch ${String(input)}`);
    });
  });
  afterEach(() => vi.restoreAllMocks());

  const webhook = async (event: string, orderId: string, eventId = `evt_${Math.random()}`, secret = keys.webhookSecret) => {
    const body = JSON.stringify({ event, payload: { payment: { entity: { id: `pay_${orderId}`, order_id: orderId } } } });
    return call('POST', '/payments/webhook/razorpay', body, { 'X-Razorpay-Signature': await hmacSha256Hex(secret, body), 'X-Razorpay-Event-Id': eventId });
  };

  it('success → paid, stock committed; duplicate webhook is ignored', async () => {
    const { variantIds: [v] } = await seedProduct([2]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    expect(r.json.next).toMatchObject({ type: 'gateway', provider: 'razorpay' });
    const rzp = r.json.next.payload.order_id as string;
    expect((await webhook('payment.captured', rzp, 'evt_1')).status).toBe(200);
    expect((await webhook('payment.captured', rzp, 'evt_1')).json.duplicate).toBe(true);
    const o = await call('GET', `/orders/${r.json.order.number}?token=${r.json.accessToken}`);
    expect(o.json).toMatchObject({ status: 'new', paymentStatus: 'paid' });
    expect(await variant(v!)).toEqual({ on_hand: 1, reserved: 0 });
  });

  it('UPI is a Razorpay payment: checkout opens on UPI, and the order records it was paid by UPI', async () => {
    const { variantIds: [v, v2] } = await seedProduct([2, 2]);
    const r = await call('POST', '/orders', { ...checkout(v!, 'gateway'), payWith: 'upi' });
    expect(r.json.next).toMatchObject({ type: 'gateway', provider: 'razorpay' });
    expect(r.json.next.payload.config.display.sequence).toEqual(['block.upi']);
    expect(r.json.next.payload.prefill.method).toBe('upi');
    // a page that still sends the old "upi" method lands on Razorpay too
    const old = await call('POST', '/orders', checkout(v2!, 'upi'));
    expect(old.json.order.paymentMethod).toBe('gateway');
    expect(old.json.next.payload.config.display.sequence).toEqual(['block.upi']);

    const rzp = r.json.next.payload.order_id as string;
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_upi1', order_id: rzp, method: 'upi' } } } });
    expect((await call('POST', '/payments/webhook/razorpay', body, { 'X-Razorpay-Signature': await hmacSha256Hex(keys.webhookSecret, body), 'X-Razorpay-Event-Id': 'evt_upi' })).status).toBe(200);
    const o = await call('GET', `/orders/${r.json.order.number}?token=${r.json.accessToken}`);
    expect(o.json.payment).toMatchObject({ method: 'gateway', status: 'paid', instrument: 'upi' });
  });

  it('cards, netbanking and wallets open without the UPI block', async () => {
    const { variantIds: [v] } = await seedProduct([2]);
    const r = await call('POST', '/orders', { ...checkout(v!, 'gateway'), payWith: 'other' });
    expect(r.json.next.payload.config.display.hide).toEqual([{ method: 'upi' }]);
  });

  it('browser return path verifies the signature', async () => {
    const { variantIds: [v] } = await seedProduct([1]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    const rzp = r.json.next.payload.order_id as string;
    const bad = await call('POST', '/payments/razorpay/return', { number: r.json.order.number, token: r.json.accessToken, params: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_1', razorpay_signature: 'nope' } });
    expect(bad.status).toBe(400);
    const sig = await hmacSha256Hex(keys.keySecret, `${rzp}|pay_1`);
    const ok = await call('POST', '/payments/razorpay/return', { number: r.json.order.number, token: r.json.accessToken, params: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_1', razorpay_signature: sig } });
    expect(ok.json.paymentStatus).toBe('paid');
  });

  it('failure → payment failed, order awaits retry, then cancels on expiry', async () => {
    const { variantIds: [v] } = await seedProduct([1]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    await webhook('payment.failed', r.json.next.payload.order_id);
    const mid = await call('GET', `/orders/${r.json.order.number}?token=${r.json.accessToken}`);
    expect(mid.json).toMatchObject({ status: 'pending_payment', paymentStatus: 'failed' });
    await expireHolds(); await runCron();
    const end = await call('GET', `/orders/${r.json.order.number}?token=${r.json.accessToken}`);
    expect(end.json.status).toBe('cancelled');
    expect(await variant(v!)).toEqual({ on_hand: 1, reserved: 0 });
  });

  it('abandoned → cancelled after 30 min hold, stock released', async () => {
    const { variantIds: [v] } = await seedProduct([1]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    expect(await variant(v!)).toEqual({ on_hand: 1, reserved: 1 });
    await expireHolds(); await runCron();
    expect(await variant(v!)).toEqual({ on_hand: 1, reserved: 0 });
    expect((await call('GET', `/orders/${r.json.order.number}?token=${r.json.accessToken}`)).json.status).toBe('cancelled');
  });

  it('rejects webhooks with a bad signature', async () => {
    expect((await webhook('payment.captured', 'order_x', 'evt_bad', 'wrong')).status).toBe(401);
  });
});

describe('checkout rules', () => {
  it('acceptance 7: pincode outside Kerala is politely blocked', async () => {
    const { variantIds: [v] } = await seedProduct([1]);
    const r = await call('POST', '/orders', { ...checkout(v!, 'cod'), address: { line1: '1 MG Road', city: 'Bengaluru', pincode: '560001' } });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('pincode_blocked');
  });

  it('acceptance 6: COD and WhatsApp orders appear in Admin with the right status', async () => {
    const { variantIds: [a, b] } = await seedProduct([1, 1]);
    const cod = await call('POST', '/orders', checkout(a!, 'cod'));
    const wa = await call('POST', '/orders', checkout(b!, 'whatsapp'));
    expect(wa.json.next.url).toContain('https://wa.me/919847000000');
    const list = await call('GET', '/admin/orders?status=new');
    const byNo = Object.fromEntries(list.json.items.map((o: { number: string }) => [o.number, o]));
    expect(byNo[cod.json.order.number]).toMatchObject({ paymentMethod: 'cod', paymentStatus: 'cod', status: 'new' });
    expect(byNo[wa.json.order.number]).toMatchObject({ paymentMethod: 'whatsapp', paymentStatus: 'unpaid', status: 'new' });
  });

  it('acceptance 9: staff cannot see payment keys or settings', async () => {
    const staff = { 'X-Dev-User': 'staff@test.local' };
    expect((await call('GET', '/admin/settings', undefined, staff)).status).toBe(403);
    expect((await call('PUT', '/admin/settings/payments/keys', { provider: 'razorpay', keys: { keyId: 'x' } }, staff)).status).toBe(403);
    expect((await call('GET', '/admin/settings')).status).toBe(200);
  });
});

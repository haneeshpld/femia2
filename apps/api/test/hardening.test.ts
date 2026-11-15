/**
 * Money and abuse safety: races (double taps, webhooks arriving together), refunds that can't be duplicated,
 * late payments on cancelled orders, staff limits, and sign-in brute force. Each test here pins a fixed bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { call, checkout, E, expireHolds, seedBasics, seedProduct, variant } from './helpers.ts';
import { reconcilePendingGateway, releaseExpiredHolds } from '../src/services/orders.ts';
import { hmacSha256Hex } from '../src/lib/crypto.ts';

const env = E as unknown as Record<string, string | undefined>;
const K = { RAZORPAY_KEY_ID: 'rzp_test_Harden1234', RAZORPAY_KEY_SECRET: 'harden_secret_0123456789', RAZORPAY_WEBHOOK_SECRET: 'harden_webhook_secret_01' };
const staff = { 'X-Dev-User': 'staff@test.local' };
const CODE = '123456';

/** Pretend Razorpay: orders, the payments on each order, refunds. */
let gwPayments: Record<string, { id: string; status: string; amount: number; currency: string; method?: string }[]> = {};
let refundCalls = 0;
let n = 0;
beforeEach(async () => {
  await seedBasics();
  await call('GET', '/admin/me'); // create the dev owner up front (tests below fire admin requests in parallel)
  gwPayments = {}; refundCalls = 0;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    if (url === 'https://api.razorpay.com/v1/orders' && method === 'POST') return Response.json({ id: `order_H${++n}` });
    const list = /\/v1\/orders\/([^/]+)\/payments$/.exec(url);
    if (list) return Response.json({ items: gwPayments[list[1]!] ?? [] });
    if (/\/v1\/payments\/[^/]+\/refund$/.test(url)) { refundCalls++; return Response.json({ id: `rfnd_H${++n}`, status: 'pending' }); }
    if (/\/v1\/payments\/[^/]+$/.test(url)) return Response.json({ method: 'upi' });
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
});
afterEach(() => { for (const k of Object.keys(K)) delete env[k]; vi.restoreAllMocks(); });

const withKeys = () => Object.assign(env, K);
const ledger = (v: string) => E.DB.prepare('SELECT reason, delta FROM stock_ledger WHERE variant_id = ? ORDER BY id').bind(v).all<{ reason: string; delta: number }>().then((r) => r.results);
const events = (number: string, status: string) => E.DB.prepare('SELECT COUNT(*) AS n FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.number = ? AND e.status = ?').bind(number, status).first<{ n: number }>().then((r) => r!.n);
const cron = async (fn: (e: typeof E, ctx: ExecutionContext) => Promise<unknown>) => { const ctx = createExecutionContext(); await fn(E, ctx); await waitOnExecutionContext(ctx); };
async function webhook(event: string, rzp: string, payId: string, amount: number, currency = 'INR') {
  const body = JSON.stringify({ event, payload: { payment: { entity: { id: payId, order_id: rzp, method: 'upi', amount, currency } } } });
  return call('POST', '/payments/webhook/razorpay', body, { 'X-Razorpay-Signature': await hmacSha256Hex(K.RAZORPAY_WEBHOOK_SECRET, body), 'X-Razorpay-Event-Id': `evt_${event}_${payId}` });
}
async function browserReturn(number: string, token: string, rzp: string, payId: string) {
  const sig = await hmacSha256Hex(K.RAZORPAY_KEY_SECRET, `${rzp}|${payId}`);
  return call('POST', '/payments/razorpay/return', { number, token, params: { razorpay_order_id: rzp, razorpay_payment_id: payId, razorpay_signature: sig } });
}

describe('cancelling twice at once', () => {
  it('a double-tapped cancel gives the stock back once', async () => {
    const { variantIds: [v] } = await seedProduct([5]);
    const r = await call('POST', '/orders', checkout(v!, 'cod'));
    const body = { token: r.json.accessToken, reason: 'Changed my mind' };
    const res = await Promise.all([call('POST', `/orders/${r.json.order.number}/cancel`, body), call('POST', `/orders/${r.json.order.number}/cancel`, body)]);
    expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
    expect(await variant(v!)).toEqual({ on_hand: 5, reserved: 0 });
    expect((await ledger(v!)).filter((l) => l.reason === 'cancel')).toHaveLength(1);
    expect(await events(r.json.order.number, 'cancelled')).toBe(1);
  });

  it('a paid UPI order cancelled twice at once records one refund to send, not two', async () => {
    const { variantIds: [v] } = await seedProduct([2], 49900);
    const r = await call('POST', '/admin/orders', { ...checkout(v!, 'upi'), channel: 'phone' });
    await call('POST', `/admin/orders/${r.json.order.number}/mark-paid`);
    await Promise.all([1, 2].map(() => call('POST', `/admin/orders/${r.json.order.number}/transition`, { to: 'cancelled', reason: 'Out of stock' })));
    const d = await call('GET', `/admin/orders/${r.json.order.number}`);
    expect(d.json.refundList).toHaveLength(1);
    expect(await variant(v!)).toEqual({ on_hand: 2, reserved: 0 });
  });
});

describe('payments confirmed several times at once', () => {
  it('a late payment confirmed by the browser and both webhooks together takes the stock once', async () => {
    withKeys();
    const { variantIds: [v] } = await seedProduct([5]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    const { number } = r.json.order; const rzp = r.json.next.payload.order_id as string; const total = r.json.order.total as number;
    await expireHolds();
    await cron(releaseExpiredHolds); // Razorpay has no payment yet: hold released, order cancelled
    expect(await variant(v!)).toEqual({ on_hand: 5, reserved: 0 });

    const res = await Promise.all([
      browserReturn(number, r.json.accessToken, rzp, 'pay_late'),
      webhook('payment.captured', rzp, 'pay_late', total),
      webhook('order.paid', rzp, 'pay_late', total),
    ]);
    expect(res.every((x) => x.status === 200)).toBe(true);
    expect(await variant(v!)).toEqual({ on_hand: 4, reserved: 0 });
    expect((await ledger(v!)).filter((l) => l.reason === 'sale')).toHaveLength(1);
    expect(await events(number, 'paid')).toBe(1);
  });

  it('a webhook whose amount doesn’t match the order is not recorded as paid', async () => {
    withKeys();
    const { variantIds: [v] } = await seedProduct([3]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    const w = await webhook('payment.captured', r.json.next.payload.order_id, 'pay_odd', 100);
    expect(w.json).toMatchObject({ ok: true, mismatch: true });
    expect((await call('GET', `/orders/${r.json.order.number}?token=${r.json.accessToken}`)).json.paymentStatus).toBe('unpaid');
  });

  it('if processing a webhook fails, Razorpay’s retry is processed (not skipped as a duplicate)', async () => {
    withKeys();
    const { variantIds: [v] } = await seedProduct([3]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    const rzp = r.json.next.payload.order_id as string;
    const batch = E.DB.batch.bind(E.DB);
    const spy = vi.spyOn(E.DB, 'batch').mockImplementationOnce(async () => { throw new Error('D1 hiccup'); });
    expect((await webhook('payment.captured', rzp, 'pay_retry', r.json.order.total)).status).toBe(500);
    spy.mockImplementation(batch);
    expect((await webhook('payment.captured', rzp, 'pay_retry', r.json.order.total)).json).toEqual({ ok: true });
    expect((await call('GET', `/orders/${r.json.order.number}?token=${r.json.accessToken}`)).json.paymentStatus).toBe('paid');
  });
});

describe('late payments on cancelled orders', () => {
  it('a shopper-cancelled order that gets paid with no webhook is found by the check and refunded', async () => {
    withKeys();
    const { variantIds: [v] } = await seedProduct([3]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    const rzp = r.json.next.payload.order_id as string;
    expect((await call('POST', `/orders/${r.json.order.number}/cancel`, { token: r.json.accessToken, reason: 'Changed my mind' })).status).toBe(200);
    // the UPI request is approved afterwards and the webhook is lost
    gwPayments[rzp] = [{ id: 'pay_ghost', status: 'captured', amount: r.json.order.total, currency: 'INR', method: 'upi' }];
    await E.DB.prepare("UPDATE payments SET updated_at = '2000-01-01T00:00:00.000Z' WHERE provider_order_id = ?").bind(rzp).run();
    await cron(reconcilePendingGateway);
    const o = (await call('GET', `/orders/${r.json.order.number}?token=${r.json.accessToken}`)).json;
    expect(o).toMatchObject({ status: 'cancelled', paymentStatus: 'paid', refunds: [{ amount: r.json.order.total, status: 'pending', toOriginal: true }] });
    expect(refundCalls).toBe(1);
  });
});

describe('refunds', () => {
  it('two refunds asked for at once can’t give back more than was paid', async () => {
    withKeys();
    const { variantIds: [v] } = await seedProduct([3], 100000);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    await browserReturn(r.json.order.number, r.json.accessToken, r.json.next.payload.order_id, 'pay_two');
    const amount = Math.ceil(r.json.order.total * 0.6);
    const res = await Promise.all([1, 2].map(() => call('POST', `/admin/orders/${r.json.order.number}/refunds`, { amount, reason: 'Return' })));
    expect(res.map((x) => x.status).sort()).toEqual([201, 422]);
    expect(refundCalls).toBe(1);
    expect((await call('GET', `/admin/orders/${r.json.order.number}`)).json.refundList).toHaveLength(1);
  });

  it('staff can’t give money back: no cancelling paid orders, retrying or marking refunds sent', async () => {
    const { variantIds: [v] } = await seedProduct([4], 49900);
    const paid = await call('POST', '/admin/orders', { ...checkout(v!, 'upi'), channel: 'phone' });
    await call('POST', `/admin/orders/${paid.json.order.number}/mark-paid`);
    expect((await call('POST', `/admin/orders/${paid.json.order.number}/transition`, { to: 'cancelled', reason: 'x' }, staff)).status).toBe(403);
    await call('POST', `/admin/orders/${paid.json.order.number}/transition`, { to: 'cancelled', reason: 'Owner cancels' });
    const id = (await call('GET', `/admin/orders/${paid.json.order.number}`)).json.refundList[0].id;
    expect((await call('POST', `/admin/refunds/${id}/sent`, { reference: 'UTR 123456' }, staff)).status).toBe(403);
    expect((await call('POST', `/admin/refunds/${id}/retry`, undefined, staff)).status).toBe(403);
    // an unpaid order is still theirs to cancel
    const cod = await call('POST', '/orders', checkout(v!, 'cod'));
    expect((await call('POST', `/admin/orders/${cod.json.order.number}/transition`, { to: 'cancelled', reason: 'Fake order' }, staff)).status).toBe(200);
  });
});

describe('abuse limits', () => {
  it('one mobile number can’t hold stock with more than three unpaid orders', async () => {
    withKeys();
    const { variantIds: [v] } = await seedProduct([10]);
    const me = (method: string) => checkout(v!, method, { customer: { name: 'Hold Tester', phone: '9000012345', email: 'holds@example.com' } });
    for (let i = 0; i < 3; i++) expect((await call('POST', '/orders', me('gateway'))).status).toBe(201);
    const fourth = await call('POST', '/orders', me('gateway'));
    expect(fourth.status).toBe(429);
    expect(fourth.json.error.code).toBe('too_many_unpaid');
    expect((await call('POST', '/orders', me('cod'))).status).toBe(201); // COD isn't a hold
    await expireHolds(); // expired holds (waiting to be released) don't count
    expect((await call('POST', '/orders', me('gateway'))).status).toBe(201);
  });

  it('many guesses at a sign-in code sent at once still get only five tries', async () => {
    const email = 'burst@example.com';
    await call('POST', '/auth/customer/start', { email });
    const guesses = await Promise.all(Array.from({ length: 12 }, (_, i) => call('POST', '/auth/customer/verify', { email, code: String(100000 + i) })));
    expect(guesses.filter((g) => g.json.error.code === 'code_wrong').length).toBeLessThanOrEqual(4);
    expect((await call('POST', '/auth/customer/verify', { email, code: CODE })).json.error.code).toBe('code_locked');
  });

  it('the newsletter form never re-subscribes someone who unsubscribed', async () => {
    await E.DB.prepare("INSERT INTO newsletter_subscribers (email, source, unsubscribed_at) VALUES ('gone@example.com', 'footer', '2026-01-01T00:00:00Z')").run();
    expect((await call('POST', '/newsletter', { email: 'gone@example.com' })).status).toBe(200);
    const row = await E.DB.prepare("SELECT unsubscribed_at FROM newsletter_subscribers WHERE email = 'gone@example.com'").first<{ unsubscribed_at: string | null }>();
    expect(row?.unsubscribed_at).toBeTruthy();
  });
});

describe('admin sign-up', () => {
  it('someone signing up with your email meanwhile can’t set your password, and you start again safely', async () => {
    const email = 'newbie@test.local';
    const mine = await call('POST', '/auth/admin/signup', { name: 'Real Person', email, password: 'Silk&Zari-2026' });
    // an attacker replaces the pending sign-up with their own password
    await E.DB.prepare('DELETE FROM otp_codes WHERE email = ?').bind(email).run();
    const theirs = await call('POST', '/auth/admin/signup', { name: 'Attacker', email, password: 'Attack&Zari-2026' });
    // the real person's code (sent to their inbox) doesn't finish the attacker's sign-up
    expect((await call('POST', '/auth/admin/signup/verify', { email, code: CODE, signupToken: mine.json.signupToken })).json.error.code).toBe('signup_expired');
    // and without the inbox the attacker can't verify at all; a missing token is refused outright
    expect((await call('POST', '/auth/admin/signup/verify', { email, code: CODE })).status).toBe(422);
    expect(theirs.json.signupToken).not.toBe(mine.json.signupToken);
    expect(await E.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first()).toBeNull();
  });
});

describe('closing the payment window and choosing another way to pay', () => {
  it('reopens the same order on UPI or on cards, without a new order or hold', async () => {
    withKeys();
    const { variantIds: [v] } = await seedProduct([3]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway', { payWith: 'upi' }));
    expect(r.json.next.payload).toMatchObject({ prefill: { method: 'upi' }, config: { display: { sequence: ['block.upi'] } } });
    const cards = await call('POST', `/orders/${r.json.order.number}/pay`, { token: r.json.accessToken, payWith: 'other' });
    expect(cards.json).toMatchObject({ status: 'pending', payload: { order_id: r.json.next.payload.order_id, amount: r.json.order.total, config: { display: { hide: [{ method: 'upi' }] } } } });
    expect(cards.json.payload.prefill.method).toBeUndefined();
    expect(await variant(v!)).toEqual({ on_hand: 3, reserved: 1 }); // still the one hold
  });

  it('switching to Cash on Delivery releases the unpaid online order, which then stays out of the account', async () => {
    withKeys();
    const { variantIds: [v] } = await seedProduct([3]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    const s = await call('POST', `/orders/${r.json.order.number}/switch-method`, { token: r.json.accessToken });
    expect(s.json).toEqual({ status: 'released' });
    expect(await variant(v!)).toEqual({ on_hand: 3, reserved: 0 });
    expect((await call('POST', `/orders/${r.json.order.number}/switch-method`, { token: r.json.accessToken })).json).toEqual({ status: 'released' }); // double tap
    const cod = await call('POST', '/orders', checkout(v!, 'cod'));
    expect(cod.status).toBe(201);
    const row = await E.DB.prepare('SELECT status, cancelled_by FROM orders WHERE number = ?').bind(r.json.order.number).first();
    expect(row).toEqual({ status: 'cancelled', cancelled_by: 'customer' }); // a payment landing later is refunded
  });

  it('if the online payment went through after all, the switch is refused and the order is paid', async () => {
    withKeys();
    const { variantIds: [v] } = await seedProduct([3]);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    gwPayments[r.json.next.payload.order_id] = [{ id: 'pay_quick', status: 'captured', amount: r.json.order.total, currency: 'INR' }];
    expect((await call('POST', `/orders/${r.json.order.number}/switch-method`, { token: r.json.accessToken })).json).toEqual({ status: 'paid' });
    expect(await variant(v!)).toEqual({ on_hand: 2, reserved: 0 });
    expect((await call('POST', `/orders/${r.json.order.number}/switch-method`, { token: 'wrong-token-123' })).status).toBe(404);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { call, checkout, E, expireHolds, seedBasics, seedProduct, variant } from './helpers.ts';
import { releaseExpiredHolds } from '../src/services/orders.ts';
import { hmacSha256Hex } from '../src/lib/crypto.ts';

const env = E as unknown as Record<string, string | undefined>;
const SECRETS = { RAZORPAY_KEY_ID: 'rzp_test_EnvKey1234', RAZORPAY_KEY_SECRET: 'env_secret_0123456789', RAZORPAY_WEBHOOK_SECRET: 'env_webhook_secret_0123' };
type Pay = { id: string; status: string; amount: number; currency: string };

/** A pretend Razorpay: orders, their payments, and capture. Records every call. */
let payments: Record<string, Pay[]> = {};
let calls: { url: string; method: string; body?: string; auth?: string | null }[] = [];
let down = false;
let n = 0;
beforeEach(async () => {
  await seedBasics();
  Object.assign(env, SECRETS);
  payments = {}; calls = []; down = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body as string | undefined, auth: new Headers(init?.headers).get('Authorization') });
    if (!url.startsWith('https://api.razorpay.com/')) throw new Error(`unexpected fetch ${url}`);
    if (down) return new Response('gateway down', { status: 503 });
    if (url === 'https://api.razorpay.com/v1/orders' && method === 'POST') return Response.json({ id: `order_T${++n}` });
    const m = /\/v1\/orders\/([^/]+)\/payments$/.exec(url);
    if (m) return Response.json({ items: payments[m[1]!] ?? [] });
    const cap = /\/v1\/payments\/([^/]+)\/capture$/.exec(url);
    if (cap) return Response.json({ id: cap[1], status: 'captured' });
    throw new Error(`unexpected razorpay call ${method} ${url}`);
  });
});
afterEach(() => { for (const k of Object.keys(SECRETS)) delete env[k]; vi.restoreAllMocks(); });

const runCron = async () => { const ctx = createExecutionContext(); const r = await releaseExpiredHolds(E, ctx); await waitOnExecutionContext(ctx); return r; };
const order = (num: string) => E.DB.prepare('SELECT status, payment_status, stock_state FROM orders WHERE number = ?').bind(num).first<{ status: string; payment_status: string; stock_state: string }>();

describe('Razorpay with keys from Worker secrets', () => {
  it('uses the secret keys, never sends the key secret to the browser, and shows test mode in Admin', async () => {
    const { variantIds: [v] } = await seedProduct([3], 129900);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    expect(r.json.next).toMatchObject({ type: 'gateway', provider: 'razorpay', payload: { key: SECRETS.RAZORPAY_KEY_ID, amount: r.json.order.total, currency: 'INR' } });
    expect(JSON.stringify(r.json)).not.toContain(SECRETS.RAZORPAY_KEY_SECRET);
    expect(calls[0]!.auth).toBe(`Basic ${btoa(`${SECRETS.RAZORPAY_KEY_ID}:${SECRETS.RAZORPAY_KEY_SECRET}`)}`);
    expect(JSON.parse(calls[0]!.body!)).toMatchObject({ amount: r.json.order.total, currency: 'INR', payment_capture: 1, receipt: r.json.order.number });

    const s = await call('GET', '/admin/settings');
    expect(s.json.gateway).toMatchObject({ mode: 'test' });
    expect(s.json.gateway.fields.map((f: { id: string; source: string }) => [f.id, f.source])).toEqual([['keyId', 'secret'], ['keySecret', 'secret'], ['webhookSecret', 'secret']]);
    expect(JSON.stringify(s.json)).not.toContain(SECRETS.RAZORPAY_KEY_SECRET);
  });

  it('confirms the browser return with the secret key signature', async () => {
    const { variantIds: [v] } = await seedProduct([3], 129900);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    const rzp = r.json.next.payload.order_id;
    const sig = await hmacSha256Hex(SECRETS.RAZORPAY_KEY_SECRET, `${rzp}|pay_ok`);
    const ok = await call('POST', '/payments/razorpay/return', { number: r.json.order.number, token: r.json.accessToken, params: { razorpay_order_id: rzp, razorpay_payment_id: 'pay_ok', razorpay_signature: sig } });
    expect(ok.json).toMatchObject({ paymentStatus: 'paid', status: 'new' });
  });

  it('refuses webhooks until a webhook secret exists, and accepts signed ones after', async () => {
    delete env.RAZORPAY_WEBHOOK_SECRET;
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_x' } } } });
    expect((await call('POST', '/payments/webhook/razorpay', body, { 'X-Razorpay-Signature': await hmacSha256Hex('anything', body) })).status).toBe(503);
    env.RAZORPAY_WEBHOOK_SECRET = SECRETS.RAZORPAY_WEBHOOK_SECRET;
    expect((await call('POST', '/payments/webhook/razorpay', body, { 'X-Razorpay-Signature': 'forged' })).status).toBe(401);
  });
});

describe('payments are never lost when a webhook is missed', () => {
  async function pendingOrder() {
    const { variantIds: [v] } = await seedProduct([2], 129900);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    return { v: v!, number: r.json.order.number as string, token: r.json.accessToken as string, rzp: r.json.next.payload.order_id as string, total: r.json.order.total as number };
  }

  it('a captured payment found at hold expiry is recorded as paid, not cancelled', async () => {
    const o = await pendingOrder();
    payments[o.rzp] = [{ id: 'pay_cap', status: 'captured', amount: o.total, currency: 'INR' }];
    await expireHolds();
    await runCron();
    expect(await order(o.number)).toMatchObject({ payment_status: 'paid', status: 'new', stock_state: 'committed' });
  });

  it('an authorised payment is captured for the exact amount, then recorded', async () => {
    const o = await pendingOrder();
    payments[o.rzp] = [{ id: 'pay_auth', status: 'authorized', amount: o.total, currency: 'INR' }];
    await expireHolds();
    await runCron();
    const cap = calls.find((c) => c.url.endsWith('/payments/pay_auth/capture'))!;
    expect(JSON.parse(cap.body!)).toEqual({ amount: o.total, currency: 'INR' });
    expect((await order(o.number))!.payment_status).toBe('paid');
  });

  it('a payment for a different amount does not count; no payment means the hold is released', async () => {
    const o = await pendingOrder();
    payments[o.rzp] = [{ id: 'pay_wrong', status: 'captured', amount: 100, currency: 'INR' }];
    await expireHolds();
    await runCron();
    expect(await order(o.number)).toMatchObject({ status: 'cancelled', payment_status: 'unpaid' });
    expect(await variant(o.v)).toEqual({ on_hand: 2, reserved: 0 });
  });

  it('if Razorpay is unreachable, the order is kept (not cancelled) and checked again later', async () => {
    const o = await pendingOrder();
    down = true;
    await E.DB.prepare('UPDATE orders SET hold_expires_at = ? WHERE number = ?').bind(new Date(Date.now() - 60e3).toISOString(), o.number).run();
    await runCron();
    expect((await order(o.number))!.status).toBe('pending_payment');
    down = false;
    payments[o.rzp] = [{ id: 'pay_late', status: 'captured', amount: o.total, currency: 'INR' }];
    await runCron();
    expect((await order(o.number))!.payment_status).toBe('paid');
  });

  it('“Complete your payment” reopens checkout, or notices it was already paid; Admin can check too', async () => {
    const o = await pendingOrder();
    const again = await call('POST', `/orders/${o.number}/pay`, { token: o.token });
    expect(again.json).toMatchObject({ status: 'pending', provider: 'razorpay', payload: { order_id: o.rzp } });
    expect((await call('POST', `/orders/${o.number}/pay`, { token: 'wrong-token-123' })).status).toBe(404);

    payments[o.rzp] = [{ id: 'pay_now', status: 'captured', amount: o.total, currency: 'INR' }];
    const o2 = await pendingOrder();
    expect((await call('POST', `/orders/${o.number}/pay`, { token: o.token })).json).toEqual({ status: 'paid' });
    payments[o2.rzp] = [{ id: 'pay_admin', status: 'captured', amount: o2.total, currency: 'INR' }];
    expect((await call('POST', `/admin/orders/${o2.number}/check-payment`)).json).toEqual({ status: 'paid' });
  });
});

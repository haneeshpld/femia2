/**
 * Things that go wrong on an ordinary day in a shop run by non-technical people: a button tapped twice, two people
 * on the same order, Razorpay not answering, one broken order in the queue. Each test here pins a fixed bug.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { call, checkout, E, seedBasics, seedProduct, variant } from './helpers.ts';
import { releaseExpiredHolds } from '../src/services/orders.ts';
import { syncPendingRefunds } from '../src/services/refunds.ts';
import { codeDelivery, issueCode } from '../src/services/otp.ts';
import { hmacSha256Hex } from '../src/lib/crypto.ts';

const env = E as unknown as Record<string, string | undefined>;
const K = { RAZORPAY_KEY_ID: 'rzp_test_Reliable123', RAZORPAY_KEY_SECRET: 'reliable_secret_0123456789', RAZORPAY_WEBHOOK_SECRET: 'reliable_webhook_secret_1' };
const staff = { 'X-Dev-User': 'staff@test.local' };

/** Pretend Razorpay, with refunds that can go wrong the ways they do in real life. */
type GwRefund = { id: string; payment: string; status: string; receipt: string; notes: Record<string, string> };
let gwRefunds: GwRefund[] = [];
let refundPosts = 0;
/** ok: refund made and answered · lost: refund made, answer never arrives · down: nothing made, gateway error */
let refundMode: 'ok' | 'lost' | 'down' = 'ok';
let lookupDown = false;
let n = 0;
beforeEach(async () => {
  await seedBasics();
  await call('GET', '/admin/me'); // create the dev owner up front (tests below fire admin requests in parallel)
  gwRefunds = []; refundPosts = 0; refundMode = 'ok'; lookupDown = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    if (url === 'https://api.razorpay.com/v1/orders' && method === 'POST') return Response.json({ id: `order_L${++n}` });
    if (/\/v1\/orders\/[^/]+\/payments$/.test(url)) return Response.json({ items: [] });
    const make = /\/v1\/payments\/([^/]+)\/refund$/.exec(url);
    if (make && method === 'POST') {
      refundPosts++;
      if (refundMode === 'down') return new Response('Bad gateway', { status: 502 });
      const b = JSON.parse(String(init?.body)) as { receipt: string; notes: Record<string, string> };
      const r: GwRefund = { id: `rfnd_L${++n}`, payment: make[1]!, status: 'pending', receipt: b.receipt, notes: b.notes };
      gwRefunds.push(r);
      if (refundMode === 'lost') throw new TypeError('network connection lost');
      return Response.json({ id: r.id, status: r.status });
    }
    const list = /\/v1\/payments\/([^/]+)\/refunds\?/.exec(url);
    if (list) {
      if (lookupDown) return new Response('Service unavailable', { status: 503 });
      return Response.json({ items: gwRefunds.filter((r) => r.payment === list[1]).map((r) => ({ id: r.id, status: r.status, receipt: r.receipt, notes: r.notes })) });
    }
    const st = /\/v1\/refunds\/([^/]+)$/.exec(url);
    if (st) return Response.json({ id: st[1], status: gwRefunds.find((r) => r.id === st[1])?.status ?? 'pending' });
    if (/\/v1\/payments\/[^/?]+$/.test(url)) return Response.json({ method: 'upi' });
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
});
afterEach(() => { for (const k of Object.keys(K)) delete env[k]; env.ENVIRONMENT = 'development'; delete env.FIXED_OTP_CODE; vi.restoreAllMocks(); });

const cron = async <T>(fn: (ctx: ExecutionContext) => Promise<T>) => { const ctx = createExecutionContext(); const r = await fn(ctx); await waitOnExecutionContext(ctx); return r; };
const events = (number: string, status: string) => E.DB.prepare('SELECT COUNT(*) AS n FROM order_events e JOIN orders o ON o.id = e.order_id WHERE o.number = ? AND e.status = ?').bind(number, status).first<{ n: number }>().then((r) => r!.n);
const orderRow = (number: string) => E.DB.prepare('SELECT status, stock_state FROM orders WHERE number = ?').bind(number).first<{ status: string; stock_state: string }>();
const detail = async (number: string) => (await call('GET', `/admin/orders/${number}`)).json;

async function paidOnline() {
  Object.assign(env, K);
  const { variantIds: [v] } = await seedProduct([3], 129900);
  const r = await call('POST', '/orders', checkout(v!, 'gateway'));
  const rzp = r.json.next.payload.order_id as string;
  const sig = await hmacSha256Hex(K.RAZORPAY_KEY_SECRET, `${rzp}|pay_${rzp}`);
  await call('POST', '/payments/razorpay/return', { number: r.json.order.number, token: r.json.accessToken, params: { razorpay_order_id: rzp, razorpay_payment_id: `pay_${rzp}`, razorpay_signature: sig } });
  return { number: r.json.order.number as string, token: r.json.accessToken as string, total: r.json.order.total as number };
}
const ageRefunds = () => E.DB.prepare("UPDATE refunds SET updated_at = '2000-01-01T00:00:00.000Z'").run();

describe('order status buttons', () => {
  it('“Confirm order” tapped twice confirms once: one timeline entry, no error for the second tap', async () => {
    const { variantIds: [v] } = await seedProduct([2]);
    const o = (await call('POST', '/orders', checkout(v!, 'cod'))).json.order;
    const [a, b] = await Promise.all([1, 2].map(() => call('POST', `/admin/orders/${o.number}/transition`, { to: 'confirmed' })));
    expect([a!.status, b!.status]).toEqual([200, 200]);
    expect(await events(o.number, 'confirmed')).toBe(1);
    // and again later (the page was open in two tabs): still fine, still one entry
    expect((await call('POST', `/admin/orders/${o.number}/transition`, { to: 'confirmed' })).json.status).toBe('confirmed');
    expect(await events(o.number, 'confirmed')).toBe(1);
  });

  it('staff shipping an order while the shopper cancels it: exactly one of them wins', async () => {
    const { variantIds: [v] } = await seedProduct([1]);
    const r = (await call('POST', '/orders', checkout(v!, 'cod'))).json;
    const [confirm, cancel] = await Promise.all([
      call('POST', `/admin/orders/${r.order.number}/transition`, { to: 'confirmed' }),
      call('POST', `/orders/${r.order.number}/cancel`, { token: r.accessToken, reason: 'Changed my mind' }),
    ]);
    const now = await orderRow(r.order.number);
    if (now!.status === 'cancelled') {
      // the unit is back on the shelf, and a confirmation that lost the race left nothing behind
      expect(await variant(v!)).toMatchObject({ on_hand: 1, reserved: 0 });
      if (confirm.status !== 200) expect(await events(r.order.number, 'confirmed')).toBe(0);
    } else {
      expect(now!.status).toBe('confirmed');
      expect(cancel.status).toBe(409);
      expect(await variant(v!)).toMatchObject({ on_hand: 0 });
    }
    expect(await events(r.order.number, 'cancelled')).toBeLessThanOrEqual(1);
  });

  it('a tracking link must be a web address', async () => {
    const bad = await call('POST', '/admin/orders/FEM1/transition', { to: 'shipped', courier: 'DTDC', trackingUrl: 'javascript:alert(1)' });
    expect(bad.status).toBe(422);
    expect(bad.json.error.details.fields.trackingUrl).toContain('https://');
  });
});

describe('the 5-minute jobs', () => {
  it('one order that can’t be released doesn’t keep the other expired holds stuck', async () => {
    const { variantIds: [a, b] } = await seedProduct([1, 1]);
    const first = (await call('POST', '/orders', checkout(a!, 'upi'))).json.order;
    const second = (await call('POST', '/orders', checkout(b!, 'upi', { customer: { name: 'Mini Jose', phone: '9847055555', email: 'mini@example.com' } }))).json.order;
    await E.DB.prepare("UPDATE orders SET hold_expires_at = '2000-01-01T00:00:00.000Z' WHERE number = ?").bind(first.number).run();
    await E.DB.prepare("UPDATE orders SET hold_expires_at = '2000-01-02T00:00:00.000Z' WHERE number = ?").bind(second.number).run();
    // the first order's stock record is damaged: releasing it fails every time
    await E.DB.prepare('UPDATE variants SET reserved = 0 WHERE id = ?').bind(a).run();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    expect(await cron((ctx) => releaseExpiredHolds(E, ctx))).toBe(1);
    expect(await orderRow(second.number)).toMatchObject({ status: 'cancelled', stock_state: 'released' });
    expect(await variant(b!)).toMatchObject({ on_hand: 1, reserved: 0 });
  });
});

describe('sign-in codes', () => {
  it('asking for shopper codes with an admin’s email can’t lock that admin out of Admin', async () => {
    const email = 'owner@test.local';
    const ctx = createExecutionContext();
    for (let i = 0; i < 8; i++) {
      await issueCode(E, ctx, 'customer', email, '203.0.113.9');
      await E.DB.prepare("UPDATE otp_codes SET consumed_at = 'x' WHERE email = ?").bind(email).run();
    }
    await expect(issueCode(E, ctx, 'customer', email, '203.0.113.9')).rejects.toMatchObject({ status: 429 });
    expect(await issueCode(E, ctx, 'admin_login', email, '198.51.100.7')).toMatchObject({ resendIn: 30 });
    await waitOnExecutionContext(ctx);
  });

  it('on the live shop, the team’s temporary fixed code can’t reset anyone’s password', async () => {
    env.ENVIRONMENT = 'production'; env.FIXED_OTP_CODE = '482916';
    expect(codeDelivery(E, 'admin_login')).toMatchObject({ mode: 'fixed' }); // still the second step after a password
    for (const email of ['owner@test.local', 'nobody@example.com']) {
      const r = await call('POST', '/auth/admin/forgot', { email });
      expect(r.status).toBe(503);
      expect(r.json.error.code).toBe('codes_unavailable');
    }
    expect((await call('POST', '/auth/admin/reset', { email: 'owner@test.local', code: '482916', password: 'Brand-New-Pass-77' })).status).toBe(400);
  });
});

describe('refunds when Razorpay doesn’t answer', () => {
  it('a refund that went through but whose answer was lost is picked up, never sent twice', async () => {
    const o = await paidOnline();
    refundMode = 'lost'; lookupDown = true;
    const r = await call('POST', `/admin/orders/${o.number}/refunds`, { amount: 10000, reason: 'Loose button' });
    expect(r.json).toMatchObject({ status: 'pending' });
    // the amount stays held, so nobody can refund the same money again while it's unclear
    let d = await detail(o.number);
    expect(d).toMatchObject({ refundable: o.total - 10000 });
    expect(d.refundList[0]).toMatchObject({ status: 'pending', providerRefundId: null });
    expect((await call('POST', `/admin/refunds/${r.json.id}/retry`)).status).toBe(409);

    // Razorpay is reachable again: the 5-minute job finds the refund it made
    lookupDown = false; refundMode = 'ok';
    await ageRefunds();
    await syncPendingRefunds(E);
    d = await detail(o.number);
    expect(d.refundList).toHaveLength(1);
    expect(d.refundList[0]).toMatchObject({ status: 'pending', providerRefundId: gwRefunds[0]!.id });
    expect(refundPosts).toBe(1);
  });

  it('with the answer lost but Razorpay reachable, the refund is found straight away', async () => {
    const o = await paidOnline();
    refundMode = 'lost';
    const r = await call('POST', `/admin/orders/${o.number}/refunds`, { amount: 10000, reason: 'Loose button' });
    expect(r.json).toMatchObject({ status: 'pending', error: null });
    expect((await detail(o.number)).refundList[0].providerRefundId).toBe(gwRefunds[0]!.id);
    expect(refundPosts).toBe(1);
  });

  it('a refund Razorpay never made fails clearly, and retrying it from two tabs sends it once', async () => {
    const o = await paidOnline();
    refundMode = 'down';
    const failed = await call('POST', `/admin/orders/${o.number}/refunds`, { amount: 10000, reason: 'Loose button' });
    expect(failed.json.status).toBe('failed');
    expect(gwRefunds).toHaveLength(0);

    refundMode = 'ok';
    const tries = await Promise.all([1, 2].map(() => call('POST', `/admin/refunds/${failed.json.id}/retry`)));
    expect(tries.map((t) => t.status).sort()).toEqual([200, 409]);
    expect(gwRefunds).toHaveLength(1);
    const d = await detail(o.number);
    expect(d.refundList).toHaveLength(1);
    expect(d.refundList[0]).toMatchObject({ status: 'pending', providerRefundId: gwRefunds[0]!.id });
    expect(d.refundable).toBe(o.total - 10000);
  });

  it('a refund that failed at the bank can be sent again', async () => {
    const o = await paidOnline();
    const r = await call('POST', `/admin/orders/${o.number}/refunds`, { amount: 10000, reason: 'Loose button' });
    const firstId = gwRefunds[0]!.id;
    gwRefunds[0]!.status = 'failed';
    const body = JSON.stringify({ event: 'refund.failed', payload: { refund: { entity: { id: firstId, payment_id: 'pay_x', status: 'failed' } } } });
    await call('POST', '/payments/webhook/razorpay', body, { 'X-Razorpay-Signature': await hmacSha256Hex(K.RAZORPAY_WEBHOOK_SECRET, body), 'X-Razorpay-Event-Id': `evt_failed_${firstId}` });
    expect((await detail(o.number)).refundList[0].status).toBe('failed');

    const retry = await call('POST', `/admin/refunds/${r.json.id}/retry`);
    expect(retry.json.status).toBe('pending');
    expect(gwRefunds).toHaveLength(2);
    expect((await detail(o.number)).refundList[0].providerRefundId).toBe(gwRefunds[1]!.id);
  });
});

describe('what staff can see', () => {
  it('printing a bill or opening a customer never hands staff the shopper’s secret order link', async () => {
    await E.DB.prepare("INSERT OR IGNORE INTO customers (id, email, name, phone, email_verified_at) VALUES ('cus_rel', 'anu@example.com', 'Anu Thomas', '9847012345', '2026-01-01T00:00:00.000Z')").run();
    const { variantIds: [v] } = await seedProduct([2]);
    const r = (await call('POST', '/orders', checkout(v!, 'cod'))).json;
    const doc = await call('GET', `/admin/orders/${r.order.number}/document`, undefined, staff);
    expect(doc.json.order).toMatchObject({ number: r.order.number, customer_name: 'Anu Thomas' });
    expect(doc.text).not.toContain(r.accessToken);
    const cu = await call('GET', '/admin/customers/cus_rel', undefined, staff);
    expect(cu.json.orders.some((x: { number: string }) => x.number === r.order.number)).toBe(true);
    expect(cu.text).not.toContain(r.accessToken);
  });
});

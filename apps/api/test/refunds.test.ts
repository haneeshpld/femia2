import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import { call, checkout, E, seedBasics, seedProduct, variant } from './helpers.ts';
import { syncPendingRefunds } from '../src/services/refunds.ts';
import { hmacSha256Hex } from '../src/lib/crypto.ts';

const env = E as unknown as Record<string, string | undefined>;
const K = { RAZORPAY_KEY_ID: 'rzp_test_RefundKey99', RAZORPAY_KEY_SECRET: 'refund_secret_0123456789', RAZORPAY_WEBHOOK_SECRET: 'refund_webhook_secret_01' };
let refunds: Record<string, string> = {};
let calls: { url: string; method: string; body?: string }[] = [];
let refundFails = false;
let n = 0;
beforeEach(async () => {
  await seedBasics();
  Object.assign(env, K);
  refunds = {}; calls = []; refundFails = false;
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input instanceof Request ? input.url : input);
    const method = init?.method ?? 'GET';
    calls.push({ url, method, body: init?.body as string | undefined });
    if (url === 'https://api.razorpay.com/v1/orders' && method === 'POST') return Response.json({ id: `order_R${++n}` });
    if (/\/v1\/orders\/[^/]+\/payments$/.test(url)) return Response.json({ items: [] });
    const rf = /\/v1\/payments\/([^/]+)\/refund$/.exec(url);
    if (rf) {
      if (refundFails) return Response.json({ error: { description: 'The amount must be at least INR 1.00' } }, { status: 400 });
      const id = `rfnd_${++n}`; refunds[id] = 'pending';
      return Response.json({ id, status: 'pending', payment_id: rf[1] });
    }
    // before a retry, the API asks which refunds this payment already has (none made it in these tests)
    if (/\/v1\/payments\/[^/]+\/refunds\?/.test(url)) return Response.json({ items: [] });
    const st = /\/v1\/refunds\/([^/]+)$/.exec(url);
    if (st) return Response.json({ id: st[1], status: refunds[st[1]!] ?? 'pending' });
    throw new Error(`unexpected fetch ${method} ${url}`);
  });
});
afterEach(() => { for (const k of Object.keys(K)) delete env[k]; vi.restoreAllMocks(); });

async function paidOnline(stock = 3) {
  const { variantIds: [v] } = await seedProduct([stock], 129900);
  const r = await call('POST', '/orders', checkout(v!, 'gateway'));
  const rzp = r.json.next.payload.order_id as string;
  const sig = await hmacSha256Hex(K.RAZORPAY_KEY_SECRET, `${rzp}|pay_${rzp}`);
  const paid = await call('POST', '/payments/razorpay/return', { number: r.json.order.number, token: r.json.accessToken, params: { razorpay_order_id: rzp, razorpay_payment_id: `pay_${rzp}`, razorpay_signature: sig } });
  return { v: v!, number: r.json.order.number as string, token: r.json.accessToken as string, rzp, total: r.json.order.total as number, paid: paid.json };
}
const refundWebhook = async (event: string, refundId: string) => {
  const body = JSON.stringify({ event, payload: { refund: { entity: { id: refundId, payment_id: 'pay_x', status: event.split('.')[1] } } } });
  return call('POST', '/payments/webhook/razorpay', body, { 'X-Razorpay-Signature': await hmacSha256Hex(K.RAZORPAY_WEBHOOK_SECRET, body), 'X-Razorpay-Event-Id': `evt_${refundId}_${event}` });
};

describe('payment details on the order', () => {
  it('shows the payment reference, gateway order and when it was paid', async () => {
    const o = await paidOnline();
    expect(o.paid.payment).toMatchObject({ method: 'gateway', status: 'paid', provider: 'razorpay', reference: `pay_${o.rzp}`, gatewayOrderId: o.rzp, amount: o.total });
    expect(o.paid.payment.paidAt).toBeTruthy();
    expect(o.paid.canCancel).toBe(true);
  });
});

describe('the shopper cancels', () => {
  it('a paid online order: cancelled, stock back, refund to the original method, then completed by webhook', async () => {
    const o = await paidOnline(3);
    const r = await call('POST', `/orders/${o.number}/cancel`, { token: o.token, reason: 'Ordered by mistake' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ status: 'cancelled', cancelledBy: 'customer', canCancel: false, refunds: [{ amount: o.total, status: 'pending', toOriginal: true }] });
    expect(await variant(o.v)).toEqual({ on_hand: 3, reserved: 0 });
    const call1 = calls.find((c) => c.url.endsWith(`/v1/payments/pay_${o.rzp}/refund`))!;
    expect(JSON.parse(call1.body!)).toMatchObject({ amount: o.total, speed: 'normal', notes: { order_number: o.number } });

    const refundId = r.json.refunds[0].reference as string;
    expect((await refundWebhook('refund.processed', refundId)).json).toMatchObject({ refund: true });
    const after = await call('GET', `/orders/${o.number}?token=${o.token}`);
    expect(after.json).toMatchObject({ paymentStatus: 'refunded', refunds: [{ status: 'processed' }] });
    expect(after.json.timeline.map((e: { note: string }) => e.note)).toEqual(expect.arrayContaining([expect.stringContaining('Refund of'), expect.stringContaining('completed')]));
  });

  it('an unpaid Cash on Delivery order cancels with nothing to refund', async () => {
    const { variantIds: [v] } = await seedProduct([2]);
    const r = await call('POST', '/orders', checkout(v!, 'cod'));
    const c = await call('POST', `/orders/${r.json.order.number}/cancel`, { token: r.json.accessToken, reason: 'Changed my mind', note: 'Will order later' });
    expect(c.json).toMatchObject({ status: 'cancelled', refunds: [] });
    expect(calls.some((x) => x.url.includes('/refund'))).toBe(false);
  });

  it('can’t cancel once packed, or with someone else’s link', async () => {
    const o = await paidOnline();
    expect((await call('POST', `/orders/${o.number}/cancel`, { token: 'not-the-token-123', reason: 'Other' })).status).toBe(404);
    await call('POST', `/admin/orders/${o.number}/transition`, { to: 'confirmed' });
    await call('POST', `/admin/orders/${o.number}/transition`, { to: 'packed' });
    const late = await call('POST', `/orders/${o.number}/cancel`, { token: o.token, reason: 'Other' });
    expect(late.json.error).toMatchObject({ code: 'too_late' });
  });

  it('a payment that lands after the shopper cancelled is refunded, and the order stays cancelled', async () => {
    const { variantIds: [v] } = await seedProduct([2], 129900);
    const r = await call('POST', '/orders', checkout(v!, 'gateway'));
    await call('POST', `/orders/${r.json.order.number}/cancel`, { token: r.json.accessToken, reason: 'Changed my mind' });
    const rzp = r.json.next.payload.order_id;
    const body = JSON.stringify({ event: 'payment.captured', payload: { payment: { entity: { id: 'pay_late', order_id: rzp } } } });
    await call('POST', '/payments/webhook/razorpay', body, { 'X-Razorpay-Signature': await hmacSha256Hex(K.RAZORPAY_WEBHOOK_SECRET, body), 'X-Razorpay-Event-Id': 'evt_late' });
    const o = await call('GET', `/orders/${r.json.order.number}?token=${r.json.accessToken}`);
    expect(o.json).toMatchObject({ status: 'cancelled', paymentStatus: 'paid', refunds: [{ amount: r.json.order.total, status: 'pending' }] });
  });
});

describe('the store refunds', () => {
  it('cancelling an order paid by UPI outside Razorpay records a refund to send; marking it sent completes it', async () => {
    // e.g. a phone order the shopper paid by UPI straight to the shop, entered by staff
    const { variantIds: [v] } = await seedProduct([2], 49900);
    const r = await call('POST', '/admin/orders', { ...checkout(v!, 'upi'), channel: 'phone' });
    await call('POST', `/admin/orders/${r.json.order.number}/mark-paid`);
    await call('POST', `/admin/orders/${r.json.order.number}/transition`, { to: 'cancelled', reason: 'Out of stock in that colour' });
    const d = await call('GET', `/admin/orders/${r.json.order.number}`);
    expect(d.json).toMatchObject({ status: 'cancelled', cancelledBy: 'store', refundable: 0, refundList: [{ status: 'to_send', amount: r.json.order.total, provider: null }] });
    const id = d.json.refundList[0].id;
    expect((await call('POST', `/admin/refunds/${id}/sent`, { reference: 'UTR 4021 7788 1234' })).status).toBe(200);
    const done = await call('GET', `/admin/orders/${r.json.order.number}`);
    expect(done.json).toMatchObject({ paymentStatus: 'refunded', refundList: [{ status: 'sent', reference: 'UTR 4021 7788 1234' }] });
  });

  it('part refunds need the owner, can’t exceed what was paid, and a failed refund can be retried', async () => {
    const o = await paidOnline();
    const staff = { 'X-Dev-User': 'staff@test.local' };
    expect((await call('POST', `/admin/orders/${o.number}/refunds`, { amount: 10000, reason: 'Loose button' }, staff)).status).toBe(403);
    expect((await call('POST', `/admin/orders/${o.number}/refunds`, { amount: o.total + 100, reason: 'Too much' })).json.error.details.fields.amount).toContain('Up to');

    refundFails = true;
    const failed = await call('POST', `/admin/orders/${o.number}/refunds`, { amount: 10000, reason: 'Loose button' });
    expect(failed.json).toMatchObject({ status: 'failed', error: 'The amount must be at least INR 1.00' });
    refundFails = false;
    const retry = await call('POST', `/admin/refunds/${failed.json.id}/retry`);
    expect(retry.json.status).toBe('pending');
    const d = await call('GET', `/admin/orders/${o.number}`);
    expect(d.json).toMatchObject({ refundable: o.total - 10000, paymentStatus: 'paid', status: 'new' });

    // the 5-minute job follows the refund to completion
    refunds[d.json.refundList[0].providerRefundId] = 'processed';
    await E.DB.prepare("UPDATE refunds SET updated_at = '2000-01-01T00:00:00.000Z'").run();
    const ctx = createExecutionContext(); await syncPendingRefunds(E); await waitOnExecutionContext(ctx);
    expect((await call('GET', `/admin/orders/${o.number}`)).json.refundList[0].status).toBe('processed');
    const list = await call('GET', '/admin/orders?status=all');
    expect(list.json.items.find((x: { number: string }) => x.number === o.number).refundState).toBe('done');
  });
});

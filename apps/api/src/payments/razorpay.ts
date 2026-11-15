import { hmacSha256Hex, safeEqual } from '../lib/crypto.ts';
import { GatewayRejection, type PaymentProvider, type RefundState } from './provider.ts';

type Keys = { keyId: string; keySecret: string; webhookSecret: string };
const refundState = (s: string | undefined): RefundState => (s === 'processed' ? 'processed' : s === 'failed' ? 'failed' : 'pending');

export const razorpay: PaymentProvider<Keys> = {
  id: 'razorpay',
  label: 'Razorpay',
  keyFields: [
    { id: 'keyId', label: 'Key ID', secret: false },
    { id: 'keySecret', label: 'Key secret', secret: true },
    { id: 'webhookSecret', label: 'Webhook secret', secret: true },
  ],

  async createOrder(args, keys) {
    const res = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(`${keys.keyId}:${keys.keySecret}`) },
      // payment_capture: capture straight away so money never sits "authorised" and auto-refunds
      body: JSON.stringify({ amount: args.amount, currency: 'INR', receipt: args.number, payment_capture: 1, notes: { order_id: args.orderId, number: args.number } }),
    });
    if (!res.ok) throw new Error(`razorpay create order ${res.status}: ${await res.text()}`);
    const o = (await res.json()) as { id: string };
    return {
      providerOrderId: o.id,
      // Options for Razorpay Checkout (checkout.js) in the browser.
      payload: razorpay.checkoutFor({
        key: keys.keyId, order_id: o.id, amount: args.amount, currency: 'INR', name: args.storeName, description: `Order ${args.number}`,
        prefill: { name: args.customer.name, email: args.customer.email, contact: args.customer.phone },
        theme: { color: '#7A1628' },
      }, args.payWith ?? null),
    };
  },

  checkoutFor(payload, payWith) {
    const { config: _c, prefill, ...rest } = payload as { config?: unknown; prefill?: Record<string, unknown> } & Record<string, unknown>;
    const { method: _m, ...who } = prefill ?? {};
    return { ...rest, prefill: { ...who, ...(payWith === 'upi' ? { method: 'upi' } : {}) }, ...(payWith ? { config: displayFor(payWith) } : {}) };
  },

  async verifyClientReturn(p, keys) {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = p;
    if (!oid || !pid || !sig) return null;
    const expected = await hmacSha256Hex(keys.keySecret, `${oid}|${pid}`);
    if (!safeEqual(expected, sig)) return null;
    // Best effort: which instrument they used (UPI, card…), for the order page.
    const pay = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(pid)}`, { headers: { Authorization: 'Basic ' + btoa(`${keys.keyId}:${keys.keySecret}`) } })
      .then((r) => (r.ok ? (r.json() as Promise<{ method?: string }>) : null)).catch(() => null);
    return { providerOrderId: oid, providerPaymentId: pid, instrument: pay?.method ?? null };
  },

  async verifyWebhook(req, rawBody, keys) {
    if (!keys.webhookSecret) return null; // without a webhook secret nothing can be trusted; reconciliation covers it
    const sig = req.headers.get('X-Razorpay-Signature') ?? '';
    const expected = await hmacSha256Hex(keys.webhookSecret, rawBody);
    if (!safeEqual(expected, sig)) return null;
    const body = JSON.parse(rawBody) as {
      event: string;
      payload: { payment?: { entity: { id: string; order_id: string; method?: string; amount?: number; currency?: string } }; order?: { entity: { id: string } }; refund?: { entity: { id: string; payment_id: string; status: string } } };
    };
    if (body.event.startsWith('refund.') && body.payload.refund) {
      const r = body.payload.refund.entity;
      const status = body.event === 'refund.processed' ? 'processed' : body.event === 'refund.failed' ? 'failed' : 'pending';
      return { eventId: req.headers.get('X-Razorpay-Event-Id') ?? `${body.event}:${r.id}`, providerOrderId: '', providerPaymentId: r.payment_id, outcome: 'refund', refund: { providerRefundId: r.id, status }, raw: body };
    }
    const eventId = req.headers.get('X-Razorpay-Event-Id') ?? `${body.event}:${body.payload.payment?.entity.id ?? body.payload.order?.entity.id}`;
    const pay = body.payload.payment?.entity;
    const providerOrderId = pay?.order_id ?? body.payload.order?.entity.id ?? '';
    const outcome = body.event === 'payment.captured' || body.event === 'order.paid' ? 'paid' : body.event === 'payment.failed' ? 'failed' : 'ignored';
    return { eventId, providerOrderId, providerPaymentId: pay?.id ?? null, instrument: pay?.method ?? null, amount: pay?.amount ?? null, currency: pay?.currency ?? null, outcome, raw: body };
  },

  async checkOrder(providerOrderId, expectedAmount, keys) {
    const auth = { Authorization: 'Basic ' + btoa(`${keys.keyId}:${keys.keySecret}`) };
    const res = await fetch(`https://api.razorpay.com/v1/orders/${encodeURIComponent(providerOrderId)}/payments`, { headers: auth });
    if (!res.ok) throw new Error(`razorpay order payments ${res.status}: ${await res.text()}`);
    const { items = [] } = (await res.json()) as { items?: { id: string; status: string; amount: number; currency: string; method?: string }[] };
    const ours = items.filter((p) => p.amount === expectedAmount && p.currency === 'INR');
    const captured = ours.find((p) => p.status === 'captured');
    if (captured) return { status: 'paid', providerPaymentId: captured.id, instrument: captured.method ?? null };
    const authorised = ours.find((p) => p.status === 'authorized');
    if (authorised) {
      const cap = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(authorised.id)}/capture`, {
        method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ amount: expectedAmount, currency: 'INR' }),
      });
      if (cap.ok) return { status: 'paid', providerPaymentId: authorised.id, instrument: authorised.method ?? null };
      throw new Error(`razorpay capture ${cap.status}: ${await cap.text()}`);
    }
    return { status: 'pending', providerPaymentId: null };
  },

  async refund(providerPaymentId, amount, keys, notes) {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(providerPaymentId)}/refund`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + btoa(`${keys.keyId}:${keys.keySecret}`) },
      body: JSON.stringify({ amount, speed: 'normal', notes, receipt: notes.refund_id }),
    });
    const data = (await res.json().catch(() => ({}))) as { id?: string; status?: string; error?: { description?: string } };
    if (!res.ok || !data.id) {
      const message = data.error?.description ?? `Razorpay refund failed (${res.status})`;
      // A 4xx carrying Razorpay's own error is a clear refusal. A 5xx or an unreadable answer is not.
      throw res.status >= 400 && res.status < 500 && data.error ? new GatewayRejection(message) : new Error(message);
    }
    return { providerRefundId: data.id, status: refundState(data.status) };
  },

  async findRefund(providerPaymentId, refundId, keys) {
    const res = await fetch(`https://api.razorpay.com/v1/payments/${encodeURIComponent(providerPaymentId)}/refunds?count=100`, { headers: { Authorization: 'Basic ' + btoa(`${keys.keyId}:${keys.keySecret}`) } });
    if (!res.ok) throw new Error(`razorpay refunds of payment ${res.status}`);
    const { items = [] } = (await res.json()) as { items?: { id: string; status?: string; receipt?: string | null; notes?: unknown }[] };
    // refund() sends our id as both the receipt and notes.refund_id
    const made = items.find((r) => r.receipt === refundId || (r.notes as { refund_id?: string } | null)?.refund_id === refundId);
    return made ? { providerRefundId: made.id, status: refundState(made.status) } : null;
  },

  async refundStatus(providerRefundId, keys) {
    const res = await fetch(`https://api.razorpay.com/v1/refunds/${encodeURIComponent(providerRefundId)}`, { headers: { Authorization: 'Basic ' + btoa(`${keys.keyId}:${keys.keySecret}`) } });
    if (!res.ok) throw new Error(`razorpay refund status ${res.status}`);
    const r = (await res.json()) as { status: string };
    return refundState(r.status);
  },

  envKeys(env) {
    return { keyId: env.RAZORPAY_KEY_ID?.trim(), keySecret: env.RAZORPAY_KEY_SECRET?.trim(), webhookSecret: env.RAZORPAY_WEBHOOK_SECRET?.trim() };
  },
};

/**
 * Razorpay Checkout display: "UPI" opens on UPI alone (Google Pay, PhonePe, Paytm, BHIM or any UPI ID / QR);
 * "other" shows cards, netbanking, wallets and EMI. Both are the same Razorpay payment underneath.
 */
function displayFor(payWith: 'upi' | 'other') {
  return payWith === 'upi'
    ? { display: { blocks: { upi: { name: 'Pay using UPI', instruments: [{ method: 'upi' }] } }, sequence: ['block.upi'], preferences: { show_default_blocks: false } } }
    : { display: { hide: [{ method: 'upi' }], preferences: { show_default_blocks: true } } };
}

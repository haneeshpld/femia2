import { hmacSha256Hex, safeEqual } from '../lib/crypto.ts';
import type { PaymentProvider } from './provider.ts';

type Keys = { keyId: string; keySecret: string; webhookSecret: string };

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
      body: JSON.stringify({ amount: args.amount, currency: 'INR', receipt: args.number, notes: { order_id: args.orderId, number: args.number } }),
    });
    if (!res.ok) throw new Error(`razorpay create order ${res.status}: ${await res.text()}`);
    const o = (await res.json()) as { id: string };
    return {
      providerOrderId: o.id,
      // Options for Razorpay Checkout (checkout.js) in the browser.
      payload: {
        key: keys.keyId, order_id: o.id, amount: args.amount, currency: 'INR', name: args.storeName, description: `Order ${args.number}`,
        prefill: { name: args.customer.name, email: args.customer.email, contact: args.customer.phone }, theme: { color: '#7A1628' },
      },
    };
  },

  async verifyClientReturn(p, keys) {
    const { razorpay_order_id: oid, razorpay_payment_id: pid, razorpay_signature: sig } = p;
    if (!oid || !pid || !sig) return null;
    const expected = await hmacSha256Hex(keys.keySecret, `${oid}|${pid}`);
    return safeEqual(expected, sig) ? { providerOrderId: oid, providerPaymentId: pid } : null;
  },

  async verifyWebhook(req, rawBody, keys) {
    const sig = req.headers.get('X-Razorpay-Signature') ?? '';
    const expected = await hmacSha256Hex(keys.webhookSecret, rawBody);
    if (!safeEqual(expected, sig)) return null;
    const body = JSON.parse(rawBody) as {
      event: string;
      payload: { payment?: { entity: { id: string; order_id: string } }; order?: { entity: { id: string } } };
    };
    const eventId = req.headers.get('X-Razorpay-Event-Id') ?? `${body.event}:${body.payload.payment?.entity.id ?? body.payload.order?.entity.id}`;
    const pay = body.payload.payment?.entity;
    const providerOrderId = pay?.order_id ?? body.payload.order?.entity.id ?? '';
    const outcome = body.event === 'payment.captured' || body.event === 'order.paid' ? 'paid' : body.event === 'payment.failed' ? 'failed' : 'ignored';
    return { eventId, providerOrderId, providerPaymentId: pay?.id ?? null, outcome, raw: body };
  },
};

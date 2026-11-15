import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv, Env } from '../env.ts';
import { escHtml, sendTelegram } from '../notify/index.ts';
import type { WebhookResult } from '../payments/provider.ts';
import { edgeLimit } from '../lib/security.ts';
import { first } from '../lib/db.ts';
import { HttpError, notFound, readJson } from '../lib/http.ts';
import { getGatewayKeys, getProvider } from '../payments/index.ts';
import { getOrderRow, markPaid, markPaymentFailed, orderForCustomer } from '../services/orders.ts';
import { applyRefundStatus, type RefundRow } from '../services/refunds.ts';

export const paymentRoutes = new Hono<AppEnv>();

/** Fast path: the browser posts the gateway's signed success payload; we verify the signature, never trust the browser. */
paymentRoutes.post('/payments/:provider/return', async (c) => {
  await edgeLimit(c, 'pay-return');
  const body = await readJson(c, z.object({ number: z.string(), token: z.string(), params: z.record(z.string(), z.string()) }));
  const provider = getProvider(c.req.param('provider'));
  const o = await first<{ id: string; access_token: string }>(c.env.DB, 'SELECT id, access_token FROM orders WHERE number = ? AND access_token = ?', body.number, body.token);
  if (!o) throw notFound('Order not found');
  const keys = await getGatewayKeys(c.env, provider.id);
  if (!keys) throw new HttpError(503, 'gateway_unconfigured', 'Online payments are not set up');
  const ok = await provider.verifyClientReturn(body.params, keys);
  if (!ok) throw new HttpError(400, 'bad_signature', "We couldn't verify that payment. If money was deducted, it will be confirmed automatically in a few minutes.");
  const pay = await first<{ order_id: string }>(c.env.DB, 'SELECT order_id FROM payments WHERE provider = ? AND provider_order_id = ?', provider.id, ok.providerOrderId);
  if (pay?.order_id !== o.id) throw new HttpError(400, 'mismatch', 'Payment does not belong to this order');
  await markPaid(c.env, c.executionCtx, (await getOrderRow(c.env.DB, { id: o.id }))!, `gateway:${provider.id}`, { provider: provider.id, ...ok });
  return c.json(await orderForCustomer(c.env.DB, body.number, body.token));
});

/** Source of truth: gateway webhooks (signature verified, idempotent by event id). */
paymentRoutes.post('/payments/webhook/:provider', async (c) => {
  const provider = getProvider(c.req.param('provider'));
  const raw = await c.req.text();
  const keys = await getGatewayKeys(c.env, provider.id);
  // No webhook secret yet: refuse (Razorpay retries), and the 5-minute reconciliation still confirms payments.
  if (!keys?.webhookSecret) return c.json({ ok: false, error: 'webhook secret not configured' }, 503);
  const evt = await provider.verifyWebhook(c.req.raw, raw, keys);
  if (!evt) return c.json({ error: 'invalid signature' }, 401);

  const fresh = await c.env.DB.prepare('INSERT OR IGNORE INTO webhook_events (provider, event_id) VALUES (?, ?)').bind(provider.id, evt.eventId).run();
  if (!fresh.meta.changes) return c.json({ ok: true, duplicate: true });
  try {
    return c.json(await handleWebhook(c.env, c.executionCtx, provider.id, evt));
  } catch (e) {
    // Processing failed: forget the event so Razorpay's retry is handled instead of skipped as a duplicate.
    await c.env.DB.prepare('DELETE FROM webhook_events WHERE provider = ? AND event_id = ?').bind(provider.id, evt.eventId).run().catch(() => {});
    throw e;
  }
});

async function handleWebhook(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, providerId: string, evt: WebhookResult) {
  if (evt.outcome === 'ignored') return { ok: true };
  if (evt.outcome === 'refund' && evt.refund) {
    const r = await first<RefundRow>(env.DB, 'SELECT * FROM refunds WHERE provider = ? AND provider_refund_id = ?', providerId, evt.refund.providerRefundId);
    if (r) await applyRefundStatus(env, r, evt.refund.status);
    return { ok: true, refund: !!r };
  }

  const pay = await first<{ order_id: string; amount: number }>(env.DB, 'SELECT order_id, amount FROM payments WHERE provider = ? AND provider_order_id = ?', providerId, evt.providerOrderId);
  if (!pay) return { ok: true, unknown: true };
  const order = (await getOrderRow(env.DB, { id: pay.order_id }))!;
  if (evt.outcome === 'paid') {
    // The gateway order fixes the amount, but never record a payment that doesn't match what we asked for.
    if ((evt.amount != null && evt.amount !== pay.amount) || (evt.currency != null && evt.currency !== 'INR')) {
      console.error('webhook amount mismatch', order.number, evt.amount, evt.currency, pay.amount);
      ctx.waitUntil(sendTelegram(env, `⚠️ <b>Payment amount mismatch</b> on ${escHtml(order.number)}: gateway says ${escHtml(String(evt.amount))} ${escHtml(evt.currency ?? '')}, order is ${pay.amount} paise. Not marked paid; check Razorpay.`));
      return { ok: true, mismatch: true };
    }
    await markPaid(env, ctx, order, `gateway:${providerId}`, { provider: providerId, providerOrderId: evt.providerOrderId, providerPaymentId: evt.providerPaymentId, instrument: evt.instrument });
  } else await markPaymentFailed(env, ctx, order, evt.providerOrderId);
  return { ok: true };
}

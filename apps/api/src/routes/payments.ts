import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../env.ts';
import { first } from '../lib/db.ts';
import { HttpError, notFound, readJson } from '../lib/http.ts';
import { getGatewayKeys, getProvider } from '../payments/index.ts';
import { getOrderRow, markPaid, markPaymentFailed, orderForCustomer } from '../services/orders.ts';

export const paymentRoutes = new Hono<AppEnv>();

/** Fast path: the browser posts the gateway's signed success payload; we verify the signature, never trust the browser. */
paymentRoutes.post('/payments/:provider/return', async (c) => {
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
  if (!keys) return c.json({ ok: false }, 503);
  const evt = await provider.verifyWebhook(c.req.raw, raw, keys);
  if (!evt) return c.json({ error: 'invalid signature' }, 401);

  const fresh = await c.env.DB.prepare('INSERT OR IGNORE INTO webhook_events (provider, event_id) VALUES (?, ?)').bind(provider.id, evt.eventId).run();
  if (!fresh.meta.changes) return c.json({ ok: true, duplicate: true });
  if (evt.outcome === 'ignored') return c.json({ ok: true });

  const pay = await first<{ order_id: string }>(c.env.DB, 'SELECT order_id FROM payments WHERE provider = ? AND provider_order_id = ?', provider.id, evt.providerOrderId);
  if (!pay) return c.json({ ok: true, unknown: true });
  const order = (await getOrderRow(c.env.DB, { id: pay.order_id }))!;
  if (evt.outcome === 'paid') await markPaid(c.env, c.executionCtx, order, `gateway:${provider.id}`, { provider: provider.id, providerOrderId: evt.providerOrderId, providerPaymentId: evt.providerPaymentId });
  else await markPaymentFailed(c.env, c.executionCtx, order, evt.providerOrderId);
  return c.json({ ok: true });
});

import { Hono } from 'hono';
import {
  AnalyticsBatch, CartQuoteRequest, NewsletterRequest, PincodeCheckRequest, ProductListQuery, STATE_PINCODES, TrackRequest, canShipTo, stateForPincode,
} from '@femia/contracts';
import type { AppEnv } from '../env.ts';
import { first } from '../lib/db.ts';
import { notFound, parse, readJson } from '../lib/http.ts';
import { getProduct, listCategories, listCollections, listProducts, stockForProduct, stockForVariants } from '../services/catalog.ts';
import { getDraft, getPublished, verifyPreviewToken } from '../services/content.ts';
import { createOrder, orderForCustomer, quote, trackOrder } from '../services/orders.ts';
import { getSettings, toPublicSettings } from '../services/settings.ts';

export const publicRoutes = new Hono<AppEnv>();

const cached = (seconds: number) => `public, max-age=${Math.min(seconds, 60)}, s-maxage=${seconds}, stale-while-revalidate=600`;

publicRoutes.get('/catalog/categories', async (c) => {
  c.header('Cache-Control', cached(60));
  return c.json(await listCategories(c.env.DB));
});

publicRoutes.get('/catalog/collections', async (c) => {
  const kind = c.req.query('kind');
  c.header('Cache-Control', cached(60));
  return c.json(await listCollections(c.env.DB, kind === 'occasion' || kind === 'collection' ? kind : undefined));
});

publicRoutes.get('/catalog/products', async (c) => {
  const q = parse(ProductListQuery, c.req.queries() && Object.fromEntries(Object.entries(c.req.queries()).map(([k, v]) => [k, v.length > 1 ? v : v[0]])));
  c.header('Cache-Control', cached(60));
  return c.json(await listProducts(c.env.DB, q));
});

publicRoutes.get('/catalog/products/:slug', async (c) => {
  const p = await getProduct(c.env.DB, c.req.param('slug'));
  if (!p) throw notFound('Product not found');
  c.header('Cache-Control', cached(60));
  return c.json(p);
});

publicRoutes.get('/catalog/products/:slug/stock', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await stockForProduct(c.env.DB, c.req.param('slug')));
});

publicRoutes.get('/catalog/stock', async (c) => {
  const ids = (c.req.query('variantIds') ?? '').split(',').filter(Boolean).slice(0, 60);
  c.header('Cache-Control', 'no-store');
  return c.json(await stockForVariants(c.env.DB, ids));
});

publicRoutes.post('/cart/quote', async (c) => {
  const body = await readJson(c, CartQuoteRequest);
  return c.json(await quote(c.env.DB, body.lines));
});

publicRoutes.post('/checkout/pincode', async (c) => {
  const { pincode } = await readJson(c, PincodeCheckRequest);
  const s = await getSettings(c.env.DB);
  const state = stateForPincode(pincode);
  const ok = canShipTo(pincode, s.shipping.shipToStates);
  return c.json({
    ok,
    state: state ? STATE_PINCODES[state].name : null,
    message: ok ? `We deliver to ${STATE_PINCODES[state!].name}` : /^[1-9]\d{5}$/.test(pincode)
      ? "Sorry, we currently deliver only within Kerala. Visit our boutique or message us on WhatsApp and we'll help."
      : 'Enter a 6-digit pincode',
  });
});

publicRoutes.post('/orders', async (c) => c.json(await createOrder(c.env, c.executionCtx, await c.req.json().catch(() => null)), 201));

publicRoutes.get('/orders/:number', async (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(await orderForCustomer(c.env.DB, c.req.param('number').toUpperCase(), c.req.query('token') ?? ''));
});

publicRoutes.post('/orders/track', async (c) => {
  const t = await readJson(c, TrackRequest);
  return c.json(await trackOrder(c.env.DB, t.number, t.phone));
});

publicRoutes.post('/newsletter', async (c) => {
  const { email, source } = await readJson(c, NewsletterRequest);
  await c.env.DB.prepare('INSERT INTO newsletter_subscribers (email, source) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET unsubscribed_at = NULL').bind(email, source).run();
  return c.json({ ok: true });
});

publicRoutes.get('/content/published', async (c) => {
  c.header('Cache-Control', cached(60));
  return c.json(await getPublished(c.env.DB));
});

publicRoutes.get('/content/preview', async (c) => {
  c.header('Cache-Control', 'no-store');
  if (!c.env.SECRETS_KEY || !(await verifyPreviewToken(c.env.SECRETS_KEY, c.req.query('token') ?? ''))) throw notFound('This preview link has expired. Open a new preview from Admin.');
  const d = await getDraft(c.env.DB);
  return c.json({ version: 0, publishedAt: d.savedAt ?? new Date().toISOString(), data: d.data, media: d.media });
});

publicRoutes.get('/settings/public', async (c) => {
  c.header('Cache-Control', cached(60));
  return c.json(toPublicSettings(await getSettings(c.env.DB)));
});

publicRoutes.post('/events', async (c) => {
  const { events } = await readJson(c, AnalyticsBatch);
  await c.env.DB.batch(events.map((e) => c.env.DB.prepare(
    'INSERT INTO analytics_events (name, session_id, path, product_id, variant_id, value, meta) VALUES (?,?,?,?,?,?,?)',
  ).bind(e.name, e.sessionId, e.path ?? null, e.productId ?? null, e.variantId ?? null, e.value ?? null, e.meta ? JSON.stringify(e.meta) : null)));
  return c.body(null, 204);
});

/** Product photos from R2, immutable (each upload gets a new key). */
publicRoutes.get('/media/*', async (c) => {
  const key = c.req.path.replace(/^\/media\//, '');
  if (!/^[a-z0-9_/.-]+\.webp$/i.test(key) || key.includes('..')) throw notFound();
  const obj = await c.env.MEDIA.get(key);
  if (!obj) throw notFound('Image not found');
  return new Response(obj.body, {
    headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'public, max-age=31536000, immutable', ETag: obj.httpEtag },
  });
});

publicRoutes.get('/health', async (c) => {
  const ok = await first<{ one: number }>(c.env.DB, 'SELECT 1 AS one');
  return c.json({ ok: ok?.one === 1, env: c.env.ENVIRONMENT });
});

import { Hono } from 'hono';
import {
  AdminOrderListQuery, AdminProductListQuery, ContentDraftInput, GatewayKeysInput, ManualOrderInput, MediaPatch, OrderNoteInput,
  OrderTransitionInput, ProductStatusInput, Settings, StockAdjustInput, PERMISSIONS, AdminInvite, AdminApprove, PasswordChange, passwordProblem, RefundInput, ManualRefundSent, CheckoutRequest, CategoryInput, CollectionInput, CatalogPresets,
} from '@femia/contracts';
import { z } from 'zod';
import type { AppEnv } from '../env.ts';
import { can, requireAdmin } from '../lib/auth.ts';
import { all, audit, first, newId } from '../lib/db.ts';
import { conflict, forbidden, HttpError, notFound, parse, readJson } from '../lib/http.ts';
import { gatewayKeySources, getGatewayKeys, PROVIDERS, putGatewayKeysStatement } from '../payments/index.ts';
import { listCategories, listCollections } from '../services/catalog.ts';
import * as content from '../services/content.ts';
import { deleteMedia, listMedia, mediaUsages, uploadMedia } from '../services/media.ts';
import { createOrder, getOrderRow, markPaid, orderItems, reconcileGatewayOrder, toPublicOrder, transitionOrder } from '../services/orders.ts';
import { duplicateProduct, getAdminProduct, listAdminProducts, lowStock, saveProduct, setProductStatus } from '../services/products.ts';
import { deleteOffer, listOffers, saveOffer, setOfferActive } from '../services/offers.ts';
import { getSettings, putSettingStatement } from '../services/settings.ts';
import { customerOrders, listAddresses } from '../services/customers.ts';
import { listRefunds, markRefundSent, refundable, retryRefund, startRefund, syncRefund, type RefundRow } from '../services/refunds.ts';
import { deviceLabel, revokeAllStatement } from '../services/sessions.ts';
import { hashPassword, rateLimit, verifyPassword } from '../lib/security.ts';
import { escHtml, sendEmail } from '../notify/index.ts';
import { adjustStock, stockHistory } from '../services/stock.ts';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('*', requireAdmin);

const actorOf = (c: { get(k: 'user'): { email: string } }) => c.get('user').email;

// ── session ──
adminRoutes.get('/me', (c) => {
  const u = c.get('user');
  c.header('Cache-Control', 'no-store');
  return c.json({ id: u.id, email: u.email, name: u.name, role: u.roleId, permissions: [...u.permissions] });
});

// ── dashboard ──
adminRoutes.get('/dashboard', can('dashboard.view'), async (c) => {
  const db = c.env.DB;
  const settings = await getSettings(db);
  // IST day boundaries
  const istNow = new Date(Date.now() + 5.5 * 3600e3);
  const startToday = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth(), istNow.getUTCDate()) - 5.5 * 3600e3).toISOString();
  const start7 = new Date(Date.parse(startToday) - 6 * 864e5).toISOString();
  const sales = `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders WHERE status NOT IN ('cancelled','pending_payment') AND created_at >= ?`;
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();
  const start14 = new Date(Date.parse(startToday) - 13 * 864e5).toISOString();
  const start30 = iso(30 * 864e5);
  const counted = "o.status NOT IN ('cancelled','pending_payment')";
  const [stages, closed, stalled, cod, expiring, top, offers, given, prev] = await Promise.all([
    all<{ status: string; n: number; oldest: string }>(db,
      "SELECT status, COUNT(*) AS n, MIN(updated_at) AS oldest FROM orders WHERE status IN ('pending_payment','new','confirmed','packed','shipped') GROUP BY status"),
    all<{ status: string; n: number }>(db, "SELECT status, COUNT(*) AS n FROM orders WHERE status IN ('delivered','cancelled') AND updated_at >= ? GROUP BY status", start30),
    // sitting too long: new > 1 day, confirmed / packed > 2 days, shipped > 7 days
    all<{ status: string; n: number }>(db,
      `SELECT status, COUNT(*) AS n FROM orders WHERE (status = 'new' AND updated_at < ?) OR (status IN ('confirmed','packed') AND updated_at < ?) OR (status = 'shipped' AND updated_at < ?) GROUP BY status`,
      iso(864e5), iso(2 * 864e5), iso(7 * 864e5)),
    first<{ n: number; total: number }>(db, "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM orders WHERE payment_method = 'cod' AND payment_status != 'paid' AND status IN ('new','confirmed','packed','shipped')"),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM orders WHERE status = 'pending_payment' AND hold_expires_at IS NOT NULL AND hold_expires_at < ?", new Date(now + 2 * 3600e3).toISOString()),
    all<{ title: string; slug: string; qty: number; revenue: number }>(db,
      `SELECT oi.title, oi.slug, SUM(oi.qty) AS qty, SUM(oi.line_total) AS revenue FROM order_items oi JOIN orders o ON o.id = oi.order_id
       WHERE ${counted} AND o.created_at >= ? GROUP BY oi.product_id ORDER BY qty DESC, revenue DESC LIMIT 3`, start7),
    listOffers(db),
    first<{ total: number }>(db, `SELECT COALESCE(SUM(d.amount),0) AS total FROM order_discounts d JOIN orders o ON o.id = d.order_id WHERE ${counted} AND o.created_at >= ?`, start7),
    first<{ orders: number; revenue: number }>(db, `SELECT COUNT(*) AS orders, COALESCE(SUM(total),0) AS revenue FROM orders o WHERE ${counted} AND o.created_at >= ? AND o.created_at < ?`, start14, start7),
  ]);
  const pipeline = Object.fromEntries(['pending_payment', 'new', 'confirmed', 'packed', 'shipped', 'delivered', 'cancelled'].map((st) => {
    const open = stages.find((x) => x.status === st);
    return [st, { count: open?.n ?? closed.find((x) => x.status === st)?.n ?? 0, oldestAt: open?.oldest ?? null, stalled: stalled.find((x) => x.status === st)?.n ?? 0 }];
  }));
  const live = offers.filter((o) => o.status === 'live');
  const endingNext = live.filter((o) => o.endsAt).sort((x, y) => Date.parse(x.endsAt!) - Date.parse(y.endsAt!))[0];

  const [today, week, waiting, awaitingPayment, low, daily] = await Promise.all([
    first<{ orders: number; revenue: number }>(db, sales, startToday),
    first<{ orders: number; revenue: number }>(db, sales, start7),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM orders WHERE status IN ('new','confirmed','packed')"),
    first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM orders WHERE status = 'pending_payment' AND payment_method = 'upi'"),
    lowStock(db, settings.notifications.lowStockThreshold, 10),
    all<{ day: string; revenue: number; orders: number }>(db,
      `SELECT date(created_at, '+330 minutes') AS day, COALESCE(SUM(total),0) AS revenue, COUNT(*) AS orders FROM orders
       WHERE status NOT IN ('cancelled','pending_payment') AND created_at >= ? GROUP BY day ORDER BY day`, start7),
  ]);
  return c.json({
    today: today ?? { orders: 0, revenue: 0 }, last7Days: week ?? { orders: 0, revenue: 0 }, daily,
    ordersWaiting: waiting?.n ?? 0, upiAwaitingVerification: awaitingPayment?.n ?? 0, lowStock: low,
    pipeline, holdsExpiringSoon: expiring?.n ?? 0,
    previous7Days: prev ?? { orders: 0, revenue: 0 },
    codToCollect: { orders: cod?.n ?? 0, amount: cod?.total ?? 0 },
    topProducts: top,
    offers: { live: live.length, names: live.slice(0, 3).map((o) => o.code ?? (o.label || o.name)), endingNext: endingNext ? { name: endingNext.name, endsAt: endingNext.endsAt } : null, given7Days: given?.total ?? 0 },
  });
});

// ── catalog ──
adminRoutes.get('/categories', can('catalog.read'), async (c) =>
  c.json(await all(c.env.DB, 'SELECT id, slug, name, sort, image_id AS imageId FROM categories ORDER BY sort, name')));
adminRoutes.get('/collections', can('catalog.read'), async (c) =>
  c.json(await all(c.env.DB, 'SELECT id, slug, name, kind, description, sort, image_id AS imageId, active FROM collections ORDER BY kind, sort, name')));
const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'item';
async function freeSlug(db: D1Database, table: 'categories' | 'collections', base: string, exceptId = '') {
  let slug = base, n = 2;
  while (await first(db, `SELECT 1 FROM ${table} WHERE slug = ? AND id != ?`, slug, exceptId)) slug = `${base}-${n++}`;
  return slug;
}

// ── offers: sales, bundles, coupons, tags ──
adminRoutes.get('/offers', can('catalog.read'), async (c) => c.json(await listOffers(c.env.DB)));
adminRoutes.post('/offers', can('offers.write'), async (c) => c.json(await saveOffer(c.env.DB, await readJson(c, z.unknown()), actorOf(c)), 201));
adminRoutes.put('/offers/:id', can('offers.write'), async (c) => c.json(await saveOffer(c.env.DB, await readJson(c, z.unknown()), actorOf(c), c.req.param('id'))));
adminRoutes.post('/offers/:id/active', can('offers.write'), async (c) => {
  const { active } = await readJson(c, z.object({ active: z.boolean() }));
  await setOfferActive(c.env.DB, c.req.param('id'), active, actorOf(c));
  return c.json({ ok: true });
});
adminRoutes.delete('/offers/:id', can('offers.write'), async (c) => {
  await deleteOffer(c.env.DB, c.req.param('id'), actorOf(c));
  return c.json({ ok: true });
});

adminRoutes.post('/categories', can('catalog.write'), async (c) => {
  const b = await readJson(c, CategoryInput);
  const dup = await first<{ id: string }>(c.env.DB, 'SELECT id FROM categories WHERE lower(name) = lower(?)', b.name);
  if (dup) throw conflict('exists', `A category called "${b.name}" already exists`, { id: dup.id });
  const id = newId('cat');
  const slug = await freeSlug(c.env.DB, 'categories', b.slug ?? slugOf(b.name));
  const sort = b.sort ?? ((await first<{ n: number }>(c.env.DB, 'SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM categories'))?.n ?? 0);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO categories (id, slug, name, sort, image_id) VALUES (?,?,?,?,?)').bind(id, slug, b.name, sort, b.imageId ?? null),
    audit(c.env.DB, actorOf(c), 'category.create', 'category', id, b.name),
  ]);
  return c.json({ id, slug, name: b.name, sort, imageId: b.imageId ?? null }, 201);
});
adminRoutes.patch('/categories/:id', can('catalog.write'), async (c) => {
  const b = await readJson(c, CategoryInput.partial());
  const cur = await first<{ id: string; name: string }>(c.env.DB, 'SELECT id, name FROM categories WHERE id = ?', c.req.param('id'));
  if (!cur) throw notFound('Category not found');
  const slug = b.slug ? await freeSlug(c.env.DB, 'categories', b.slug, cur.id) : null;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE categories SET name = COALESCE(?, name), slug = COALESCE(?, slug), sort = COALESCE(?, sort), image_id = CASE WHEN ? THEN ? ELSE image_id END WHERE id = ?')
      .bind(b.name ?? null, slug, b.sort ?? null, b.imageId !== undefined ? 1 : 0, b.imageId ?? null, cur.id),
    audit(c.env.DB, actorOf(c), 'category.update', 'category', cur.id, b.name ?? cur.name),
  ]);
  return c.json(await first(c.env.DB, 'SELECT id, slug, name, sort, image_id AS imageId FROM categories WHERE id = ?', cur.id));
});

adminRoutes.post('/collections', can('catalog.write'), async (c) => {
  const b = await readJson(c, CollectionInput);
  const dup = await first<{ id: string }>(c.env.DB, 'SELECT id FROM collections WHERE lower(name) = lower(?)', b.name);
  if (dup) throw conflict('exists', `A collection called "${b.name}" already exists`, { id: dup.id });
  const id = newId('col');
  const slug = await freeSlug(c.env.DB, 'collections', b.slug ?? slugOf(b.name));
  const sort = b.sort ?? ((await first<{ n: number }>(c.env.DB, 'SELECT COALESCE(MAX(sort), -1) + 1 AS n FROM collections'))?.n ?? 0);
  await c.env.DB.batch([
    c.env.DB.prepare('INSERT INTO collections (id, slug, name, kind, description, sort, image_id, active) VALUES (?,?,?,?,?,?,?,?)')
      .bind(id, slug, b.name, b.kind, b.description, sort, b.imageId ?? null, b.active ? 1 : 0),
    audit(c.env.DB, actorOf(c), 'collection.create', 'collection', id, b.name),
  ]);
  return c.json({ id, slug, name: b.name, kind: b.kind, description: b.description, sort, imageId: b.imageId ?? null, active: b.active ? 1 : 0 }, 201);
});
adminRoutes.patch('/collections/:id', can('catalog.write'), async (c) => {
  const b = await readJson(c, CollectionInput.partial());
  const cur = await first<{ id: string; name: string }>(c.env.DB, 'SELECT id, name FROM collections WHERE id = ?', c.req.param('id'));
  if (!cur) throw notFound('Collection not found');
  const slug = b.slug ? await freeSlug(c.env.DB, 'collections', b.slug, cur.id) : null;
  await c.env.DB.batch([
    c.env.DB.prepare(`UPDATE collections SET name = COALESCE(?, name), slug = COALESCE(?, slug), kind = COALESCE(?, kind), description = COALESCE(?, description),
      sort = COALESCE(?, sort), active = COALESCE(?, active), image_id = CASE WHEN ? THEN ? ELSE image_id END WHERE id = ?`)
      .bind(b.name ?? null, slug, b.kind ?? null, b.description ?? null, b.sort ?? null, b.active === undefined ? null : b.active ? 1 : 0, b.imageId !== undefined ? 1 : 0, b.imageId ?? null, cur.id),
    audit(c.env.DB, actorOf(c), 'collection.update', 'collection', cur.id, b.name ?? cur.name),
  ]);
  return c.json(await first(c.env.DB, 'SELECT id, slug, name, kind, description, sort, image_id AS imageId, active FROM collections WHERE id = ?', cur.id));
});

/** Colour, size and fabric lists for the product wizard. Staff can extend them (catalog.write), unlike money settings. */
adminRoutes.get('/catalog/presets', can('catalog.read'), async (c) => c.json((await getSettings(c.env.DB)).catalog));
adminRoutes.put('/catalog/presets', can('catalog.write'), async (c) => {
  const v = await readJson(c, CatalogPresets);
  await c.env.DB.batch([putSettingStatement(c.env.DB, 'catalog', v, actorOf(c)), audit(c.env.DB, actorOf(c), 'catalog.presets', 'settings', 'catalog', 'Updated colour / size / fabric lists')]);
  return c.json(v);
});

adminRoutes.get('/storefront/categories', can('catalog.read'), async (c) => c.json(await listCategories(c.env.DB)));
adminRoutes.get('/storefront/collections', can('catalog.read'), async (c) => c.json(await listCollections(c.env.DB)));

adminRoutes.get('/products', can('catalog.read'), async (c) => c.json(await listAdminProducts(c.env.DB, parse(AdminProductListQuery, c.req.query()))));
adminRoutes.get('/products/:id', can('catalog.read'), async (c) => c.json(await getAdminProduct(c.env.DB, c.req.param('id'))));
adminRoutes.post('/products', can('catalog.write'), async (c) => c.json(await saveProduct(c.env.DB, await readJson(c, z.unknown()), actorOf(c)), 201));
adminRoutes.put('/products/:id', can('catalog.write'), async (c) => c.json(await saveProduct(c.env.DB, await readJson(c, z.unknown()), actorOf(c), c.req.param('id'))));
adminRoutes.post('/products/:id/status', can('catalog.write'), async (c) => {
  const { status } = await readJson(c, ProductStatusInput);
  return c.json(await setProductStatus(c.env.DB, c.req.param('id'), status, actorOf(c)));
});
adminRoutes.post('/products/:id/duplicate', can('catalog.write'), async (c) => c.json(await duplicateProduct(c.env.DB, c.req.param('id'), actorOf(c)), 201));

// ── stock ──
adminRoutes.post('/stock/adjust', can('stock.write'), async (c) => c.json(await adjustStock(c.env.DB, await readJson(c, StockAdjustInput), actorOf(c))));
adminRoutes.get('/stock/:variantId/history', can('catalog.read'), async (c) => c.json(await stockHistory(c.env.DB, c.req.param('variantId'))));
adminRoutes.get('/stock', can('catalog.read'), async (c) => {
  const q = c.req.query('q')?.trim();
  const low = c.req.query('filter') === 'low';
  const s = await getSettings(c.env.DB);
  const where = ["p.status != 'archived'", 'v.active = 1'];
  const binds: unknown[] = [];
  if (q) { where.push('(p.title LIKE ? OR v.sku LIKE ?)'); binds.push(`%${q}%`, `%${q}%`); }
  if (low) { where.push('(v.on_hand - v.reserved) <= COALESCE(v.low_stock_threshold, ?)'); binds.push(s.notifications.lowStockThreshold); }
  const rows = await all<Record<string, unknown>>(c.env.DB,
    `SELECT v.id, v.sku, v.option1, v.option2, v.on_hand AS onHand, v.reserved, MAX(v.on_hand - v.reserved, 0) AS available,
            COALESCE(v.low_stock_threshold, ?) AS threshold, p.id AS productId, p.title, p.status,
            (SELECT label FROM product_options po WHERE po.product_id = p.id AND po.option = 2 AND po.value = v.option2) AS colourLabel,
            (SELECT m.key_base FROM product_media pm JOIN media m ON m.id = pm.media_id WHERE pm.product_id = p.id ORDER BY (pm.option2 = v.option2) DESC, pm.sort LIMIT 1) AS imageKey
     FROM variants v JOIN products p ON p.id = v.product_id WHERE ${where.join(' AND ')}
     ORDER BY p.title, v.sort LIMIT 400`, s.notifications.lowStockThreshold, ...binds);
  return c.json(rows.map((r) => ({ ...r, thumb: r.imageKey ? `/media/${r.imageKey}/480.webp` : null })));
});
adminRoutes.get('/stock/low', can('catalog.read'), async (c) => {
  const s = await getSettings(c.env.DB);
  return c.json(await lowStock(c.env.DB, s.notifications.lowStockThreshold, 100));
});

// ── media ──
adminRoutes.get('/media', can('catalog.read'), async (c) => c.json(await listMedia(c.env.DB, Number(c.req.query('page') ?? 1))));
adminRoutes.post('/media', can('media.write'), async (c) => c.json(await uploadMedia(c.env, await c.req.formData(), actorOf(c)), 201));
adminRoutes.patch('/media/:id', can('media.write'), async (c) => {
  const { alt } = await readJson(c, MediaPatch);
  await c.env.DB.prepare('UPDATE media SET alt = ? WHERE id = ?').bind(alt, c.req.param('id')).run();
  return c.json({ ok: true });
});
adminRoutes.get('/media/:id/usages', can('catalog.read'), async (c) => c.json(await mediaUsages(c.env.DB, c.req.param('id'))));
adminRoutes.delete('/media/:id', can('media.write'), async (c) => { await deleteMedia(c.env, c.req.param('id'), actorOf(c)); return c.json({ ok: true }); });

// ── orders ──
adminRoutes.get('/orders', can('orders.read'), async (c) => {
  const q = parse(AdminOrderListQuery, c.req.query());
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q.status === 'active') where.push("status IN ('pending_payment','new','confirmed','packed','shipped')");
  else if (q.status !== 'all') { where.push('status = ?'); binds.push(q.status); }
  if (q.q) { where.push('(number LIKE ? OR phone LIKE ? OR customer_name LIKE ?)'); binds.push(`%${q.q.toUpperCase()}%`, `%${q.q}%`, `%${q.q}%`); }
  const sql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [items, total] = await Promise.all([
    all(c.env.DB, `SELECT number, status, payment_method AS paymentMethod, payment_status AS paymentStatus, channel, customer_name AS customerName,
                   phone, city, total, created_at AS createdAt, hold_expires_at AS holdExpiresAt,
                   (SELECT COUNT(*) FROM order_items i WHERE i.order_id = orders.id) AS itemCount,
                   (SELECT CASE WHEN SUM(status IN ('failed')) > 0 THEN 'failed' WHEN SUM(status IN ('pending','to_send')) > 0 THEN 'pending'
                           WHEN COUNT(*) > 0 THEN 'done' END FROM refunds r WHERE r.order_id = orders.id) AS refundState
                   FROM orders ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...binds, q.pageSize, (q.page - 1) * q.pageSize),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM orders ${sql}`, ...binds),
  ]);
  return c.json({ items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 });
});

adminRoutes.get('/orders/:number', can('orders.read'), async (c) => {
  const o = await getOrderRow(c.env.DB, { number: c.req.param('number').toUpperCase() });
  if (!o) throw notFound('Order not found');
  const [pub, events, refundRows, attempts, left] = await Promise.all([
    toPublicOrder(c.env.DB, o),
    all(c.env.DB, 'SELECT status, note, actor, public, created_at AS at FROM order_events WHERE order_id = ? ORDER BY id', o.id),
    listRefunds(c.env.DB, o.id),
    all<{ provider: string; provider_order_id: string | null; provider_payment_id: string | null; amount: number; status: string; created_at: string; updated_at: string }>(c.env.DB,
      'SELECT provider, provider_order_id, provider_payment_id, amount, status, created_at, updated_at FROM payments WHERE order_id = ? ORDER BY created_at', o.id),
    refundable(c.env.DB, o),
  ]);
  return c.json({
    ...pub, events, channel: o.channel, stockState: o.stock_state, holdExpiresAt: o.hold_expires_at, notes: o.notes, cancelReason: o.cancel_reason, cancelledBy: o.cancelled_by,
    paidAt: o.paid_at, refundable: left,
    gatewayAttempts: attempts.map((a) => ({ provider: a.provider, orderId: a.provider_order_id, paymentId: a.provider_payment_id, amount: a.amount, status: a.status, createdAt: a.created_at, updatedAt: a.updated_at })),
    refundList: refundRows.map((r) => ({ id: r.id, amount: r.amount, status: r.status, provider: r.provider, providerRefundId: r.provider_refund_id, paymentId: r.provider_payment_id,
      reference: r.reference, reason: r.reason, error: r.error, requestedBy: r.requested_by, createdAt: r.created_at, processedAt: r.processed_at })),
    address: { line1: o.line1, line2: o.line2, landmark: o.landmark, city: o.city, state: o.state, pincode: o.pincode },
  });
});

adminRoutes.post('/orders/:number/transition', can('orders.write'), async (c) => {
  const body = await readJson(c, OrderTransitionInput);
  // Cancelling a paid order gives money back (or decides not to): that's a refund decision, not an order update.
  if (body.to === 'cancelled' && !c.get('user').permissions.has('payments.refund')) {
    const cur = await getOrderRow(c.env.DB, { number: c.req.param('number').toUpperCase() });
    if (cur?.payment_status === 'paid') throw forbidden('This order is paid, so cancelling it means a refund. Ask the owner to cancel it.');
  }
  const o = await transitionOrder(c.env, c.executionCtx, c.req.param('number').toUpperCase(), body, actorOf(c));
  return c.json({ number: o.number, status: o.status });
});

adminRoutes.post('/orders/:number/mark-paid', can('orders.write'), async (c) => {
  const o = await getOrderRow(c.env.DB, { number: c.req.param('number').toUpperCase() });
  if (!o) throw notFound('Order not found');
  if (o.payment_method === 'gateway') throw conflict('gateway_order', 'Online payments are confirmed by the gateway automatically');
  if (o.payment_status === 'paid') throw conflict('already_paid', 'This order is already marked as paid');
  const fresh = await markPaid(c.env, c.executionCtx, o, actorOf(c));
  return c.json({ number: fresh.number, status: fresh.status, paymentStatus: fresh.payment_status });
});

// ── refunds ──
/** Refund on its own (returns, part refunds, paid-but-sold-out). Cancelling a paid order refunds by itself. */
adminRoutes.post('/orders/:number/refunds', can('payments.refund'), async (c) => {
  const v = await readJson(c, RefundInput);
  const o = await getOrderRow(c.env.DB, { number: c.req.param('number').toUpperCase() });
  if (!o) throw notFound('Order not found');
  const r = await startRefund(c.env, c.executionCtx, o, { amount: v.amount, reason: v.reason, by: actorOf(c) });
  return c.json({ id: r.id, status: r.status, error: r.error }, 201);
});
adminRoutes.post('/refunds/:id/check', can('orders.read'), async (c) => {
  const r = await first<RefundRow>(c.env.DB, 'SELECT * FROM refunds WHERE id = ?', c.req.param('id'));
  if (!r) throw notFound('Refund not found');
  try { const s = await syncRefund(c.env, r); return c.json({ status: s.status }); }
  catch { throw new HttpError(502, 'gateway_unavailable', 'Couldn’t reach the payment gateway. Try again in a minute.'); }
});
adminRoutes.post('/refunds/:id/retry', can('payments.refund'), async (c) => {
  const r = await retryRefund(c.env, c.executionCtx, c.req.param('id'), actorOf(c));
  return c.json({ id: r.id, status: r.status, error: r.error });
});
adminRoutes.post('/refunds/:id/sent', can('payments.refund'), async (c) => {
  const { reference } = await readJson(c, ManualRefundSent);
  await markRefundSent(c.env, c.req.param('id'), reference, actorOf(c));
  return c.json({ ok: true });
});

/** "Check with Razorpay": confirm an online payment straight from the gateway (missed webhook, customer says they paid). */
adminRoutes.post('/orders/:number/check-payment', can('orders.write'), async (c) => {
  const o = await getOrderRow(c.env.DB, { number: c.req.param('number').toUpperCase() });
  if (!o) throw notFound('Order not found');
  const status = await reconcileGatewayOrder(c.env, c.executionCtx, o);
  if (status === 'unavailable') throw new HttpError(502, 'gateway_unavailable', 'Couldn’t reach the payment gateway. Try again in a minute.');
  await audit(c.env.DB, actorOf(c), 'order.check_payment', 'order', o.id, `${o.number}: gateway says ${status}`).run();
  return c.json({ status });
});

adminRoutes.post('/orders/:number/notes', can('orders.write'), async (c) => {
  const { note } = await readJson(c, OrderNoteInput);
  const o = await getOrderRow(c.env.DB, { number: c.req.param('number').toUpperCase() });
  if (!o) throw notFound('Order not found');
  await c.env.DB.prepare("INSERT INTO order_events (order_id, status, note, actor, public) VALUES (?, 'note', ?, ?, 0)").bind(o.id, note, actorOf(c)).run();
  return c.json({ ok: true });
});

/** Manual order from WhatsApp / phone / shop. Same pricing and stock rules as the website. */
adminRoutes.post('/orders', can('orders.write'), async (c) => {
  const body = await c.req.json();
  const manual = parse(ManualOrderInput, body);
  // Walk-in / phone customers may not give an email: validate with a placeholder, store it empty (no emails sent).
  const email = String(body?.customer?.email ?? '').trim();
  const checkout = parse(CheckoutRequest.omit({ paymentMethod: true }), {
    ...body, customer: { ...body?.customer, email: email || 'none@invalid.example' }, clientRef: body.clientRef ?? newId('man'),
  });
  const res = await createOrder(c.env, c.executionCtx, { ...checkout, customer: { ...checkout.customer, email }, paymentMethod: manual.paymentMethod }, {
    channel: manual.channel, actor: actorOf(c), createdBy: actorOf(c), manual: { paid: manual.paid, note: manual.note },
  });
  return c.json(res, 201);
});

adminRoutes.get('/orders/:number/document', can('orders.read'), async (c) => {
  const o = await getOrderRow(c.env.DB, { number: c.req.param('number').toUpperCase() });
  if (!o) throw notFound('Order not found');
  const [items, settings, discounts] = await Promise.all([orderItems(c.env.DB, o.id), getSettings(c.env.DB),
    all(c.env.DB, 'SELECT label, code, amount FROM order_discounts WHERE order_id = ? ORDER BY id', o.id)]);
  return c.json({ order: o, items, store: settings.store, discounts }); // Admin renders bill / packing slip for print
});

// ── content ──
adminRoutes.get('/manifest', can('catalog.read'), async (c) => c.json(await content.getManifest(c.env.DB)));
adminRoutes.get('/content/draft', can('content.write'), async (c) => c.json(await content.getDraft(c.env.DB)));
adminRoutes.put('/content/draft', can('content.write'), async (c) => {
  const { data, note } = await readJson(c, ContentDraftInput);
  return c.json(await content.saveDraft(c.env.DB, data, note, actorOf(c)));
});
adminRoutes.post('/content/preview-token', can('content.write'), async (c) => {
  if (!c.env.SECRETS_KEY) throw new HttpError(500, 'secrets_unconfigured', 'SECRETS_KEY is not set');
  return c.json({ token: await content.previewToken(c.env.SECRETS_KEY) });
});
adminRoutes.post('/content/publish', can('content.publish'), async (c) => c.json(await content.publishDraft(c.env.DB, actorOf(c))));
adminRoutes.post('/content/undo', can('content.publish'), async (c) => c.json(await content.undoPublish(c.env.DB, actorOf(c))));
adminRoutes.get('/content/versions', can('content.write'), async (c) => c.json(await content.versions(c.env.DB)));
adminRoutes.get('/content/versions/:id', can('content.write'), async (c) => c.json(await content.getVersion(c.env.DB, Number(c.req.param('id')))));

// ── settings (Owner only: staff never see money settings or keys) ──
adminRoutes.get('/settings', can('settings.read'), async (c) => {
  const s = await getSettings(c.env.DB);
  const provider = PROVIDERS[s.payments.gateway.provider];
  const keys = c.get('user').permissions.has('payments.keys') ? await getGatewayKeys(c.env, s.payments.gateway.provider) : null;
  const sources = c.get('user').permissions.has('payments.keys') ? await gatewayKeySources(c.env, s.payments.gateway.provider) : {};
  return c.json({
    settings: s,
    gateway: provider ? {
      provider: provider.id, label: provider.label,
      fields: provider.keyFields.map((f) => ({ ...f, set: !!keys?.[f.id], source: sources[f.id] ?? null, preview: keys?.[f.id] && !f.secret ? keys[f.id] : keys?.[f.id] ? '••••' + keys[f.id]!.slice(-4) : null })),
      mode: keys?.keyId?.startsWith('rzp_live_') ? 'live' : keys?.keyId ? 'test' : null,
      webhookUrl: `${c.env.API_URL || new URL(c.req.url).origin}/payments/webhook/${provider.id}`,
    } : null,
  });
});

adminRoutes.put('/settings/:section', can('settings.write'), async (c) => {
  const section = c.req.param('section') as keyof Settings;
  const shape = Object.hasOwn(Settings.shape, section) ? Settings.shape[section] : undefined;
  if (!shape || section === 'catalog') throw notFound('Unknown settings section');
  const value = parse(shape, await c.req.json());
  if (section === 'payments' && value && (value as Settings['payments']).gateway.enabled) {
    const p = (value as Settings['payments']).gateway.provider;
    if (!(await getGatewayKeys(c.env, p))) throw conflict('keys_missing', 'Add the gateway keys before switching online payments on');
  }
  await c.env.DB.batch([putSettingStatement(c.env.DB, section, value, actorOf(c)), audit(c.env.DB, actorOf(c), 'settings.update', 'settings', section, `Updated ${section} settings`)]);
  return c.json((await getSettings(c.env.DB))[section]);
});

adminRoutes.put('/settings/payments/keys', can('payments.keys'), async (c) => {
  const { provider, keys } = await readJson(c, GatewayKeysInput);
  const p = PROVIDERS[provider];
  if (!p) throw notFound('Unknown provider');
  const merged = { ...((await getGatewayKeys(c.env, provider)) ?? {}), ...keys };
  const missing = p.keyFields.filter((f: { id: string }) => !merged[f.id]).map((f: { label: string }) => f.label);
  if (missing.length) throw conflict('keys_incomplete', `Missing: ${missing.join(', ')}`);
  await c.env.DB.batch([await putGatewayKeysStatement(c.env, provider, merged, actorOf(c)), audit(c.env.DB, actorOf(c), 'payments.keys', 'settings', provider, `Updated ${p.label} keys`)]);
  return c.json({ ok: true });
});

// ── people & audit ──
adminRoutes.get('/roles', can('people.manage'), async (c) => c.json({ roles: await all(c.env.DB, 'SELECT id, name, permissions, system FROM roles'), permissions: PERMISSIONS }));
const USER_COLS = `u.id, u.email, u.name, u.role_id AS roleId, u.status, u.last_seen_at AS lastSeenAt, u.last_login_at AS lastLoginAt,
  u.created_at AS createdAt, u.approved_at AS approvedAt, (u.password_hash IS NOT NULL) AS hasPassword,
  (SELECT a.name FROM users a WHERE a.email = u.approved_by OR a.id = u.approved_by) AS approvedBy,
  (SELECT COUNT(*) FROM sessions s WHERE s.kind = 'admin' AND s.subject_id = u.id AND s.revoked_at IS NULL AND s.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ','now')) AS sessions`;
adminRoutes.get('/users', can('people.manage'), async (c) =>
  c.json(await all(c.env.DB, `SELECT ${USER_COLS} FROM users u ORDER BY CASE u.status WHEN 'pending' THEN 0 ELSE 1 END, u.created_at`)));

async function activeOwners(db: D1Database) {
  return (await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM users WHERE role_id = 'owner' AND status = 'active'"))?.n ?? 0;
}
async function roleExists(db: D1Database, id: string) {
  if (!(await first(db, 'SELECT 1 FROM roles WHERE id = ?', id))) throw notFound('Unknown role');
}

/** Invite: the admin approves up front; the person then signs up with this email and is in straight away. */
adminRoutes.post('/users', can('people.manage'), async (c) => {
  const u = await readJson(c, AdminInvite);
  await roleExists(c.env.DB, u.roleId);
  if (await first(c.env.DB, 'SELECT 1 FROM users WHERE email = ?', u.email)) throw conflict('exists', 'This email is already on your team list');
  const id = newId('usr');
  await c.env.DB.batch([
    c.env.DB.prepare("INSERT INTO users (id, email, name, role_id, active, status, approved_by, approved_at) VALUES (?,?,?,?,0,'invited',?,?)")
      .bind(id, u.email, u.name, u.roleId, actorOf(c), new Date().toISOString()),
    audit(c.env.DB, actorOf(c), 'people.invite', 'user', id, `Invited ${u.email} as ${u.roleId}`),
  ]);
  const link = `${c.env.ADMIN_URL}/sign-up?email=${encodeURIComponent(u.email)}`;
  if (c.env.RESEND_API_KEY) {
    c.executionCtx.waitUntil(sendEmail(c.env, { to: u.email, subject: 'You’re invited to Femia Admin',
      html: `<p>${escHtml(c.get('user').name || 'The Femia team')} invited you to Femia Admin.</p><p><a href="${link}">Create your password</a> with this email address to get started.</p>`,
      text: `You're invited to Femia Admin. Create your password with this email address: ${link}` }));
  }
  return c.json({ ok: true, link, emailed: !!c.env.RESEND_API_KEY }, 201);
});

adminRoutes.post('/users/:id/approve', can('people.manage'), async (c) => {
  const { roleId } = await readJson(c, AdminApprove);
  await roleExists(c.env.DB, roleId);
  const u = await first<{ email: string; name: string; status: string }>(c.env.DB, 'SELECT email, name, status FROM users WHERE id = ?', c.req.param('id'));
  if (!u) throw notFound('User not found');
  if (u.status !== 'pending') throw conflict('not_pending', 'This person isn’t waiting for approval');
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE users SET status = 'active', active = 1, role_id = ?, approved_by = ?, approved_at = ? WHERE id = ? AND status = 'pending'")
      .bind(roleId, actorOf(c), new Date().toISOString(), c.req.param('id')),
    audit(c.env.DB, actorOf(c), 'people.approve', 'user', c.req.param('id'), `Approved ${u.email} as ${roleId}`),
  ]);
  if (c.env.RESEND_API_KEY) {
    c.executionCtx.waitUntil(sendEmail(c.env, { to: u.email, subject: 'Your Femia Admin access is approved',
      html: `<p>Hi ${escHtml(u.name || 'there')}, your Femia Admin account is approved. <a href="${c.env.ADMIN_URL}">Sign in</a>.</p>`, text: `Your Femia Admin account is approved. Sign in: ${c.env.ADMIN_URL}` }));
  }
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/reject', can('people.manage'), async (c) => {
  const u = await first<{ email: string; status: string }>(c.env.DB, 'SELECT email, status FROM users WHERE id = ?', c.req.param('id'));
  if (!u) throw notFound('User not found');
  if (u.status !== 'pending' && u.status !== 'invited') throw conflict('not_pending', 'Only pending requests or invites can be declined');
  await c.env.DB.batch([
    u.status === 'invited'
      ? c.env.DB.prepare('DELETE FROM users WHERE id = ?').bind(c.req.param('id'))
      : c.env.DB.prepare("UPDATE users SET status = 'rejected', active = 0 WHERE id = ?").bind(c.req.param('id')),
    audit(c.env.DB, actorOf(c), u.status === 'invited' ? 'people.uninvite' : 'people.reject', 'user', c.req.param('id'), `${u.status === 'invited' ? 'Cancelled invite for' : 'Declined'} ${u.email}`),
  ]);
  return c.json({ ok: true });
});

adminRoutes.patch('/users/:id', can('people.manage'), async (c) => {
  const body = await readJson(c, z.object({ roleId: z.string().optional(), status: z.enum(['active', 'disabled']).optional(), name: z.string().trim().max(60).optional() }));
  const id = c.req.param('id');
  const u = await first<{ email: string; role_id: string; status: string }>(c.env.DB, 'SELECT email, role_id, status FROM users WHERE id = ?', id);
  if (!u) throw notFound('User not found');
  if (id === c.get('user').id && (body.status === 'disabled' || (body.roleId && body.roleId !== u.role_id))) throw forbidden('You can’t change your own role or access. Ask another owner.');
  if (body.roleId) await roleExists(c.env.DB, body.roleId);
  if (body.status && !['active', 'disabled'].includes(u.status)) throw conflict('bad_state', 'Approve or decline this person first');
  const losingOwner = u.role_id === 'owner' && u.status === 'active' && ((body.roleId && body.roleId !== 'owner') || body.status === 'disabled');
  if (losingOwner && (await activeOwners(c.env.DB)) <= 1) throw conflict('last_owner', 'Femia needs at least one owner. Make someone else an owner first.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET role_id = COALESCE(?, role_id), status = COALESCE(?, status), active = CASE COALESCE(?, status) WHEN \'active\' THEN 1 ELSE 0 END, name = COALESCE(?, name) WHERE id = ?')
      .bind(body.roleId ?? null, body.status ?? null, body.status ?? null, body.name ?? null, id),
    ...(body.status === 'disabled' ? [revokeAllStatement(c.env.DB, 'admin', id)] : []),
    audit(c.env.DB, actorOf(c), 'people.update', 'user', id, `${u.email}: ${[body.roleId && `role → ${body.roleId}`, body.status && `access → ${body.status}`, body.name && 'renamed'].filter(Boolean).join(', ')}`),
  ]);
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/sign-out', can('people.manage'), async (c) => {
  await c.env.DB.batch([revokeAllStatement(c.env.DB, 'admin', c.req.param('id')), audit(c.env.DB, actorOf(c), 'people.sign_out', 'user', c.req.param('id'), 'Signed out of all devices')]);
  return c.json({ ok: true });
});

// ── my account: name, password, where I'm signed in ──
adminRoutes.patch('/account', async (c) => {
  const { name } = await readJson(c, z.object({ name: z.string().trim().min(2).max(60) }));
  await c.env.DB.prepare('UPDATE users SET name = ? WHERE id = ?').bind(name, c.get('user').id).run();
  return c.json({ ok: true });
});
adminRoutes.get('/account/sessions', async (c) => {
  const rows = await all<{ id: string; created_at: string; last_seen_at: string; ip: string; user_agent: string }>(c.env.DB,
    "SELECT id, created_at, last_seen_at, ip, user_agent FROM sessions WHERE kind = 'admin' AND subject_id = ? AND revoked_at IS NULL AND expires_at > ? ORDER BY last_seen_at DESC",
    c.get('user').id, new Date().toISOString());
  const cur = c.get('sessionId');
  return c.json(rows.map((r) => ({ id: r.id.slice(0, 16), device: deviceLabel(r.user_agent), ip: r.ip, createdAt: r.created_at, lastSeenAt: r.last_seen_at, current: r.id === cur })));
});
adminRoutes.delete('/account/sessions/:id', async (c) => {
  const short = c.req.param('id');
  if (!/^[0-9a-f]{16}$/.test(short)) throw notFound('Session not found');
  await c.env.DB.prepare("UPDATE sessions SET revoked_at = ? WHERE kind = 'admin' AND subject_id = ? AND substr(id, 1, 16) = ? AND revoked_at IS NULL")
    .bind(new Date().toISOString(), c.get('user').id, short).run();
  return c.json({ ok: true });
});
adminRoutes.post('/account/password', async (c) => {
  const v = await readJson(c, PasswordChange);
  const me = c.get('user');
  const row = await first<{ password_hash: string | null }>(c.env.DB, 'SELECT password_hash FROM users WHERE id = ?', me.id);
  await rateLimit(c.env.DB, `pw-change:${me.id}`, 10, 3600);
  if (!(await verifyPassword(c.env, v.current, row?.password_hash ?? null))) throw new HttpError(422, 'validation', 'Please check the highlighted fields', { fields: { current: 'That isn’t your current password' } });
  const problem = passwordProblem(v.next, { email: me.email, name: me.name });
  if (problem) throw new HttpError(422, 'validation', 'Please check the highlighted fields', { fields: { next: problem } });
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, password_changed_at = ? WHERE id = ?').bind(await hashPassword(c.env, v.next), new Date().toISOString(), me.id),
    revokeAllStatement(c.env.DB, 'admin', me.id, c.get('sessionId') ?? undefined),
    audit(c.env.DB, actorOf(c), 'auth.password_change', 'user', me.id, 'Changed password; other devices signed out'),
  ]);
  return c.json({ ok: true });
});

// ── shoppers: accounts, their orders and the offers they've used ──
adminRoutes.get('/customers', can('orders.read'), async (c) => {
  const q = (c.req.query('q') ?? '').trim().toLowerCase().slice(0, 60);
  const like = `%${q}%`;
  const rows = await all(c.env.DB, `
    SELECT cu.id, cu.email, cu.name, cu.phone, cu.disabled, cu.created_at AS createdAt, cu.last_login_at AS lastLoginAt,
      (SELECT COUNT(*) FROM orders o WHERE o.customer_id = cu.id) AS orders,
      (SELECT COALESCE(SUM(o.total),0) FROM orders o WHERE o.customer_id = cu.id AND o.status NOT IN ('cancelled','pending_payment')) AS spent,
      (SELECT MAX(o.created_at) FROM orders o WHERE o.customer_id = cu.id) AS lastOrderAt,
      (SELECT COUNT(*) FROM order_discounts d JOIN orders o ON o.id = d.order_id WHERE o.customer_id = cu.id AND o.status != 'cancelled') AS offersUsed
    FROM customers cu ${q ? 'WHERE lower(cu.email) LIKE ? OR lower(cu.name) LIKE ? OR cu.phone LIKE ?' : ''}
    ORDER BY COALESCE(lastOrderAt, cu.created_at) DESC LIMIT 200`, ...(q ? [like, like, like] : []));
  return c.json(rows);
});
adminRoutes.get('/customers/:id', can('orders.read'), async (c) => {
  const id = c.req.param('id');
  const cu = await first<Record<string, unknown>>(c.env.DB, 'SELECT id, email, name, phone, marketing, disabled, created_at AS createdAt, last_login_at AS lastLoginAt FROM customers WHERE id = ?', id);
  if (!cu) throw notFound('Customer not found');
  const [history, addresses, sessions] = await Promise.all([
    customerOrders(c.env.DB, id),
    listAddresses(c.env.DB, id),
    first<{ n: number }>(c.env.DB, "SELECT COUNT(*) AS n FROM sessions WHERE kind = 'customer' AND subject_id = ? AND revoked_at IS NULL AND expires_at > ?", id, new Date().toISOString()),
  ]);
  return c.json({ customer: cu, addresses, ...history, signedInDevices: sessions?.n ?? 0 });
});
adminRoutes.post('/customers/:id/access', can('people.manage'), async (c) => {
  const { disabled } = await readJson(c, z.object({ disabled: z.boolean() }));
  const id = c.req.param('id');
  const r = await c.env.DB.prepare('UPDATE customers SET disabled = ?, updated_at = ? WHERE id = ?').bind(disabled ? 1 : 0, new Date().toISOString(), id).run();
  if (!r.meta.changes) throw notFound('Customer not found');
  await c.env.DB.batch([
    ...(disabled ? [revokeAllStatement(c.env.DB, 'customer', id)] : []),
    audit(c.env.DB, actorOf(c), disabled ? 'customer.disable' : 'customer.enable', 'customer', id, disabled ? 'Closed account and signed out' : 'Reopened account'),
  ]);
  return c.json({ ok: true });
});
adminRoutes.post('/customers/:id/sign-out', can('people.manage'), async (c) => {
  await c.env.DB.batch([revokeAllStatement(c.env.DB, 'customer', c.req.param('id')), audit(c.env.DB, actorOf(c), 'customer.sign_out', 'customer', c.req.param('id'), 'Signed out of all devices')]);
  return c.json({ ok: true });
});
adminRoutes.get('/audit', can('audit.read'), async (c) =>
  c.json(await all(c.env.DB, 'SELECT id, actor, action, entity, entity_id AS entityId, summary, created_at AS at FROM audit_log ORDER BY id DESC LIMIT ?', Math.min(Number(c.req.query('limit') ?? 100), 500))));

import { Hono } from 'hono';
import {
  AdminOrderListQuery, AdminProductListQuery, ContentDraftInput, GatewayKeysInput, ManualOrderInput, MediaPatch, OrderNoteInput,
  OrderTransitionInput, ProductStatusInput, Settings, StockAdjustInput, UserInput, PERMISSIONS, CheckoutRequest,
} from '@femia/contracts';
import { z } from 'zod';
import type { AppEnv } from '../env.ts';
import { can, requireAdmin } from '../lib/auth.ts';
import { all, audit, first, newId } from '../lib/db.ts';
import { conflict, forbidden, HttpError, notFound, parse, readJson } from '../lib/http.ts';
import { getGatewayKeys, PROVIDERS, putGatewayKeysStatement } from '../payments/index.ts';
import { listCategories, listCollections } from '../services/catalog.ts';
import * as content from '../services/content.ts';
import { deleteMedia, listMedia, mediaUsages, uploadMedia } from '../services/media.ts';
import { createOrder, getOrderRow, markPaid, orderItems, toPublicOrder, transitionOrder } from '../services/orders.ts';
import { duplicateProduct, getAdminProduct, listAdminProducts, lowStock, saveProduct, setProductStatus } from '../services/products.ts';
import { getSettings, putSettingStatement } from '../services/settings.ts';
import { adjustStock, stockHistory } from '../services/stock.ts';

export const adminRoutes = new Hono<AppEnv>();
adminRoutes.use('*', requireAdmin);

const actorOf = (c: { get(k: 'user'): { email: string } }) => c.get('user').email;

// ── session ──
adminRoutes.get('/me', (c) => {
  const u = c.get('user');
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
  });
});

// ── catalog ──
adminRoutes.get('/categories', can('catalog.read'), async (c) =>
  c.json(await all(c.env.DB, 'SELECT id, slug, name, sort, image_id AS imageId FROM categories ORDER BY sort, name')));
adminRoutes.get('/collections', can('catalog.read'), async (c) =>
  c.json(await all(c.env.DB, 'SELECT id, slug, name, kind, description, sort, image_id AS imageId, active FROM collections ORDER BY kind, sort, name')));
adminRoutes.get('/storefront/categories', can('catalog.read'), async (c) => c.json(await listCategories(c.env.DB)));
adminRoutes.get('/storefront/collections', can('catalog.read'), async (c) => c.json(await listCollections(c.env.DB)));

adminRoutes.get('/products', can('catalog.read'), async (c) => c.json(await listAdminProducts(c.env.DB, parse(AdminProductListQuery, c.req.query()))));
adminRoutes.get('/products/:id', can('catalog.read'), async (c) => c.json(await getAdminProduct(c.env.DB, c.req.param('id'))));
adminRoutes.post('/products', can('catalog.write'), async (c) => c.json(await saveProduct(c.env.DB, await c.req.json(), actorOf(c)), 201));
adminRoutes.put('/products/:id', can('catalog.write'), async (c) => c.json(await saveProduct(c.env.DB, await c.req.json(), actorOf(c), c.req.param('id'))));
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
                   (SELECT COUNT(*) FROM order_items i WHERE i.order_id = orders.id) AS itemCount
                   FROM orders ${sql} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...binds, q.pageSize, (q.page - 1) * q.pageSize),
    first<{ n: number }>(c.env.DB, `SELECT COUNT(*) AS n FROM orders ${sql}`, ...binds),
  ]);
  return c.json({ items, page: q.page, pageSize: q.pageSize, total: total?.n ?? 0 });
});

adminRoutes.get('/orders/:number', can('orders.read'), async (c) => {
  const o = await getOrderRow(c.env.DB, { number: c.req.param('number').toUpperCase() });
  if (!o) throw notFound('Order not found');
  const [pub, events] = await Promise.all([
    toPublicOrder(c.env.DB, o),
    all(c.env.DB, 'SELECT status, note, actor, public, created_at AS at FROM order_events WHERE order_id = ? ORDER BY id', o.id),
  ]);
  return c.json({
    ...pub, events, channel: o.channel, stockState: o.stock_state, holdExpiresAt: o.hold_expires_at, notes: o.notes, cancelReason: o.cancel_reason,
    address: { line1: o.line1, line2: o.line2, landmark: o.landmark, city: o.city, state: o.state, pincode: o.pincode },
  });
});

adminRoutes.post('/orders/:number/transition', can('orders.write'), async (c) => {
  const body = await readJson(c, OrderTransitionInput);
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
  const [items, settings] = await Promise.all([orderItems(c.env.DB, o.id), getSettings(c.env.DB)]);
  return c.json({ order: o, items, store: settings.store }); // Admin renders bill / packing slip for print
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
  return c.json({
    settings: s,
    gateway: provider ? {
      provider: provider.id, label: provider.label,
      fields: provider.keyFields.map((f) => ({ ...f, set: !!keys?.[f.id], preview: keys?.[f.id] && !f.secret ? keys[f.id] : keys?.[f.id] ? '••••' + keys[f.id]!.slice(-4) : null })),
      webhookUrl: `${new URL(c.req.url).origin}/payments/webhook/${provider.id}`,
    } : null,
  });
});

adminRoutes.put('/settings/:section', can('settings.write'), async (c) => {
  const section = c.req.param('section') as keyof Settings;
  const shape = Settings.shape[section];
  if (!shape) throw notFound('Unknown settings section');
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
adminRoutes.get('/users', can('people.manage'), async (c) =>
  c.json(await all(c.env.DB, 'SELECT id, email, name, role_id AS roleId, active, last_seen_at AS lastSeenAt FROM users ORDER BY created_at')));
adminRoutes.post('/users', can('people.manage'), async (c) => {
  const u = await readJson(c, UserInput);
  if (!(await first(c.env.DB, 'SELECT 1 FROM roles WHERE id = ?', u.roleId))) throw notFound('Unknown role');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO users (id, email, name, role_id, active) VALUES (?,?,?,?,?)
      ON CONFLICT(email) DO UPDATE SET name = excluded.name, role_id = excluded.role_id, active = excluded.active`).bind(newId('usr'), u.email, u.name, u.roleId, u.active ? 1 : 0),
    audit(c.env.DB, actorOf(c), 'people.upsert', 'user', u.email, `${u.email} → ${u.roleId}${u.active ? '' : ' (disabled)'}`),
  ]);
  return c.json({ ok: true });
});
adminRoutes.patch('/users/:id', can('people.manage'), async (c) => {
  const body = await readJson(c, z.object({ roleId: z.string().optional(), active: z.boolean().optional(), name: z.string().max(60).optional() }));
  if (c.req.param('id') === c.get('user').id && (body.active === false || (body.roleId && body.roleId !== 'owner'))) throw forbidden("You can't remove your own owner access");
  const u = await first<{ email: string }>(c.env.DB, 'SELECT email FROM users WHERE id = ?', c.req.param('id'));
  if (!u) throw notFound('User not found');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET role_id = COALESCE(?, role_id), active = COALESCE(?, active), name = COALESCE(?, name) WHERE id = ?')
      .bind(body.roleId ?? null, body.active === undefined ? null : body.active ? 1 : 0, body.name ?? null, c.req.param('id')),
    audit(c.env.DB, actorOf(c), 'people.update', 'user', u.email, JSON.stringify(body)),
  ]);
  return c.json({ ok: true });
});
adminRoutes.get('/audit', can('audit.read'), async (c) =>
  c.json(await all(c.env.DB, 'SELECT id, actor, action, entity, entity_id AS entityId, summary, created_at AS at FROM audit_log ORDER BY id DESC LIMIT ?', Math.min(Number(c.req.query('limit') ?? 100), 500))));

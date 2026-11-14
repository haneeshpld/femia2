import {
  canShipTo, canTransition, CheckoutRequest, formatINR, quoteCart, STATE_PINCODES,
  type CheckoutResult, type OrderChannel, type OrderStatus, type PaymentMethod, type PricedVariant, type PublicOrder, type Quote,
} from '@femia/contracts';
import type { Env } from '../env.ts';
import { all, audit, first, isConstraintError, newId, nowIso, placeholders, token } from '../lib/db.ts';
import { conflict, HttpError, notFound, parse } from '../lib/http.ts';
import { notifyLowStock, notifyOrder } from '../notify/index.ts';
import { getGatewayKeys, getProvider, upiUri } from '../payments/index.ts';
import { getSettings } from './settings.ts';
import {
  commitDirectStatements, commitHeldStatements, holdStatements, releaseHeldStatements, restockStatements, type StockLine,
} from './stock.ts';

type Ctx = { waitUntil(p: Promise<unknown>): void };

// ───────────────────────────────── pricing ─────────────────────────────────

export async function loadPricedVariants(db: D1Database, ids: string[]): Promise<Map<string, PricedVariant>> {
  const unique = [...new Set(ids)].slice(0, 60);
  if (!unique.length) return new Map();
  const rows = await all<{
    id: string; product_id: string; slug: string; title: string; option1: string | null; option2: string | null; option2_label: string | null;
    price: number; compare_at_price: number | null; available: number; purchasable: number; image_key: string | null;
  }>(db,
    `SELECT v.id, v.product_id, p.slug, p.title, v.option1, v.option2,
            (SELECT label FROM product_options po WHERE po.product_id = p.id AND po.option = 2 AND po.value = v.option2) AS option2_label,
            COALESCE(v.price, p.price) AS price, COALESCE(v.compare_at_price, p.compare_at_price) AS compare_at_price,
            MAX(v.on_hand - v.reserved, 0) AS available,
            (v.active = 1 AND p.status = 'active') AS purchasable,
            (SELECT m.key_base FROM product_media pm JOIN media m ON m.id = pm.media_id
              WHERE pm.product_id = p.id AND (pm.option2 = v.option2 OR pm.option2 IS NULL)
              ORDER BY (pm.option2 IS NULL), (pm.role != 'main'), pm.sort LIMIT 1) AS image_key
     FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id IN (${placeholders(unique.length)})`, ...unique);
  return new Map(rows.map((r) => [r.id, {
    variantId: r.id, productId: r.product_id, slug: r.slug, title: r.title, option1: r.option1, option2: r.option2,
    optionLabel: [r.option1, r.option2_label ?? r.option2].filter(Boolean).join(' / '),
    imageUrl: r.image_key ? `/media/${r.image_key}/480.webp` : null,
    price: r.price, compareAtPrice: r.compare_at_price, available: r.available, purchasable: r.purchasable === 1,
  }]));
}

export async function quote(db: D1Database, lines: { variantId: string; qty: number }[]): Promise<Quote> {
  const [variants, settings] = await Promise.all([loadPricedVariants(db, lines.map((l) => l.variantId)), getSettings(db)]);
  return quoteCart(lines, variants, settings.shipping);
}

// ──────────────────────────────── reading ────────────────────────────────

interface OrderRow {
  id: string; number: string; access_token: string; status: OrderStatus; payment_method: PaymentMethod; payment_status: PublicOrder['paymentStatus'];
  channel: OrderChannel; stock_state: 'held' | 'committed' | 'released'; hold_expires_at: string | null;
  customer_name: string; phone: string; email: string; line1: string; line2: string; landmark: string; city: string; state: string; pincode: string;
  subtotal: number; shipping: number; total: number; courier: string | null; tracking_number: string | null; tracking_url: string | null;
  notes: string; cancel_reason: string | null; created_at: string; paid_at: string | null;
}

export async function getOrderRow(db: D1Database, by: { id?: string; number?: string }) {
  return by.id
    ? first<OrderRow>(db, 'SELECT * FROM orders WHERE id = ?', by.id)
    : first<OrderRow>(db, 'SELECT * FROM orders WHERE number = ?', by.number);
}

export async function orderItems(db: D1Database, orderId: string) {
  return all<{ variant_id: string; product_id: string; slug: string; sku: string; title: string; option_label: string; image_url: string | null; unit_price: number; qty: number; line_total: number }>(
    db, 'SELECT * FROM order_items WHERE order_id = ? ORDER BY id', orderId);
}

export async function toPublicOrder(db: D1Database, o: OrderRow): Promise<PublicOrder & { email: string; phone: string }> {
  const [items, events] = await Promise.all([
    orderItems(db, o.id),
    all<{ status: string; note: string | null; created_at: string }>(db, 'SELECT status, note, created_at FROM order_events WHERE order_id = ? AND public = 1 ORDER BY id', o.id),
  ]);
  return {
    number: o.number, status: o.status, paymentMethod: o.payment_method, paymentStatus: o.payment_status,
    items: items.map((i) => ({
      variantId: i.variant_id, productId: i.product_id, slug: i.slug, title: i.title, optionLabel: i.option_label, sku: i.sku,
      imageUrl: i.image_url, unitPrice: i.unit_price, qty: i.qty, lineTotal: i.line_total,
    })),
    subtotal: o.subtotal, shipping: o.shipping, total: o.total, customerName: o.customer_name, city: o.city, pincode: o.pincode,
    courier: o.courier, trackingNumber: o.tracking_number, trackingUrl: o.tracking_url,
    timeline: events.map((e) => ({ status: e.status, note: e.note, at: e.created_at })),
    createdAt: o.created_at, email: o.email, phone: o.phone,
  };
}

export async function trackOrder(db: D1Database, number: string, phone: string) {
  const o = await first<OrderRow>(db, 'SELECT * FROM orders WHERE number = ? AND phone = ?', number, phone);
  if (!o) throw notFound("We couldn't find that order. Check the number and the mobile used at checkout.");
  const { email: _e, phone: _p, ...pub } = await toPublicOrder(db, o);
  return pub;
}

export async function orderForCustomer(db: D1Database, number: string, accessToken: string) {
  const o = await first<OrderRow>(db, 'SELECT * FROM orders WHERE number = ? AND access_token = ?', number, accessToken);
  if (!o) throw notFound('Order not found');
  const { email: _e, phone: _p, ...pub } = await toPublicOrder(db, o);
  return pub;
}

// ──────────────────────────────── creating ────────────────────────────────

const event = (db: D1Database, orderId: string, status: string, note: string | null, actor = 'system', isPublic = true) =>
  db.prepare('INSERT INTO order_events (order_id, status, note, actor, public) VALUES (?,?,?,?,?)').bind(orderId, status, note, actor, isPublic ? 1 : 0);

export interface CreateOrderOptions {
  channel?: OrderChannel;
  actor?: string;
  createdBy?: string | null;
  /** Manual orders from Admin: stock sold straight away, payment as recorded by staff. */
  manual?: { paid: boolean; note?: string };
}

export async function createOrder(env: Env, ctx: Ctx, input: unknown, opts: CreateOrderOptions = {}): Promise<CheckoutResult> {
  const raw = input as { customer?: { email?: string } } | null;
  const manualNoEmail = !!opts.manual && raw?.customer?.email === '';
  const req = parse(CheckoutRequest, manualNoEmail ? { ...raw, customer: { ...raw!.customer, email: 'none@invalid.example' } } : input);
  if (manualNoEmail) req.customer.email = '';
  const db = env.DB;
  const settings = await getSettings(db);
  const actor = opts.actor ?? 'customer';

  const existing = await first<OrderRow>(db, 'SELECT * FROM orders WHERE client_ref = ?', req.clientRef);
  if (existing) return checkoutResult(env, existing, settings);

  if (!canShipTo(req.address.pincode, settings.shipping.shipToStates)) {
    throw new HttpError(422, 'pincode_blocked', "Sorry, we currently deliver only within Kerala. Visit our boutique or message us on WhatsApp and we'll help.");
  }
  const method = req.paymentMethod;
  if (!opts.manual) {
    const enabled = {
      upi: settings.payments.upi.enabled && !!settings.payments.upi.vpa,
      gateway: settings.payments.gateway.enabled,
      cod: settings.shipping.cod.enabled,
      whatsapp: settings.payments.whatsapp.enabled && !!settings.store.whatsapp,
    }[method];
    if (!enabled) throw new HttpError(422, 'method_unavailable', 'That payment option is not available right now. Please choose another.');
  }

  const q = await quote(db, req.lines);
  if (q.issues.length || !q.lines.length) throw conflict('cart_changed', 'Some items in your bag have changed. Please review and try again.', { quote: q });
  if (!opts.manual && method === 'cod' && settings.shipping.cod.maxOrderValue !== null && q.total > settings.shipping.cod.maxOrderValue) {
    throw new HttpError(422, 'cod_limit', `Cash on Delivery is available for orders up to ${formatINR(settings.shipping.cod.maxOrderValue)}. Please choose another payment option.`);
  }

  // Stock mode per method: gateway/UPI/WhatsApp hold until paid or confirmed; COD and manual orders sell immediately.
  const now = Date.now();
  let status: OrderStatus, paymentStatus: PublicOrder['paymentStatus'], stockState: 'held' | 'committed', holdUntil: string | null = null;
  if (opts.manual) {
    status = 'new'; paymentStatus = method === 'cod' ? 'cod' : opts.manual.paid ? 'paid' : 'unpaid'; stockState = 'committed';
  } else if (method === 'cod') {
    status = 'new'; paymentStatus = 'cod'; stockState = 'committed';
  } else {
    status = method === 'whatsapp' ? 'new' : 'pending_payment';
    paymentStatus = 'unpaid'; stockState = 'held';
    const ms = method === 'gateway' ? Number(env.GATEWAY_HOLD_MINUTES || 30) * 60e3 : settings.payments.upi.holdHours * 3600e3;
    holdUntil = new Date(now + ms).toISOString();
  }

  const orderId = newId('ord');
  const lines: StockLine[] = q.lines.map((l) => ({ variantId: l.variantId, qty: l.qty }));
  const skus = await all<{ id: string; sku: string }>(db, `SELECT id, sku FROM variants WHERE id IN (${placeholders(lines.length)})`, ...lines.map((l) => l.variantId));
  const skuOf = new Map(skus.map((s) => [s.id, s.sku]));

  const stmts: D1PreparedStatement[] = [
    db.prepare("UPDATE counters SET value = value + 1 WHERE name = 'order_number'"),
    db.prepare(
      `INSERT INTO orders (id, number, access_token, client_ref, status, payment_method, payment_status, channel, stock_state, hold_expires_at,
         customer_name, phone, email, line1, line2, landmark, city, state, pincode, subtotal, shipping, total, notes, created_by, paid_at)
       VALUES (?, 'FEM' || (SELECT value FROM counters WHERE name = 'order_number'), ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      orderId, token(), req.clientRef, status, method, paymentStatus, opts.channel ?? 'web', stockState, holdUntil,
      req.customer.name, req.customer.phone, req.customer.email, req.address.line1, req.address.line2, req.address.landmark,
      req.address.city, req.address.state, req.address.pincode, q.subtotal, q.shipping, q.total, opts.manual?.note ?? '',
      opts.createdBy ?? null, paymentStatus === 'paid' ? new Date(now).toISOString() : null,
    ),
    ...q.lines.map((l) => db.prepare(
      `INSERT INTO order_items (order_id, variant_id, product_id, slug, sku, title, option_label, image_url, unit_price, qty, line_total)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(orderId, l.variantId, l.productId, l.slug, skuOf.get(l.variantId) ?? '', l.title, l.optionLabel, l.imageUrl, l.price, l.qty, l.lineTotal)),
    ...(stockState === 'held' ? holdStatements(db, orderId, lines, actor) : commitDirectStatements(db, orderId, lines, actor)),
    event(db, orderId, status, status === 'pending_payment' ? 'Awaiting payment' : 'Order placed', actor),
    ...(req.newsletter ? [db.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email, source) VALUES (?, ?)').bind(req.customer.email, 'checkout')] : []),
    ...(opts.createdBy ? [audit(db, opts.createdBy, 'order.create_manual', 'order', orderId, `Manual ${opts.channel} order`)] : []),
  ];

  try {
    await db.batch(stmts);
  } catch (e) {
    if (isConstraintError(e)) {
      const again = await first<OrderRow>(db, 'SELECT * FROM orders WHERE client_ref = ?', req.clientRef);
      if (again) return checkoutResult(env, again, settings); // double submit raced
      throw conflict('cart_changed', 'Someone just bought the last piece of an item in your bag. Please review and try again.', { quote: await quote(db, req.lines) });
    }
    throw e;
  }

  let order = (await getOrderRow(db, { id: orderId }))!;

  if (method === 'gateway' && !opts.manual) {
    try {
      await startGatewayPayment(env, order, settings.store.name);
    } catch (e) {
      console.error('gateway create failed', e);
      await cancelOrder(env, ctx, order, 'system', 'Payment gateway unavailable', false);
      throw new HttpError(502, 'gateway_unavailable', 'Online payment is not responding right now. Please try UPI or Cash on Delivery.');
    }
    order = (await getOrderRow(db, { id: orderId }))!;
  }

  // Notifications: gateway orders notify on payment instead.
  if (method !== 'gateway' || opts.manual) {
    ctx.waitUntil((async () => {
      const pub = await toPublicOrder(db, order);
      await notifyOrder(env, pub, 'owner_new');
      if (method === 'cod' || method === 'whatsapp' || paymentStatus === 'paid') await notifyOrder(env, pub, 'received');
      await notifyLowStock(env, lines.map((l) => l.variantId));
    })());
  }
  return checkoutResult(env, order, settings);
}

async function startGatewayPayment(env: Env, order: OrderRow, storeName: string) {
  const settings = await getSettings(env.DB);
  const provider = getProvider(settings.payments.gateway.provider);
  const keys = await getGatewayKeys(env, provider.id);
  if (!keys) throw new Error('gateway keys missing');
  const { providerOrderId, payload } = await provider.createOrder(
    { orderId: order.id, number: order.number, amount: order.total, customer: { name: order.customer_name, email: order.email, phone: order.phone }, storeName },
    keys, env,
  );
  await env.DB.prepare('INSERT INTO payments (id, order_id, provider, provider_order_id, amount, status, raw) VALUES (?,?,?,?,?,?,?)')
    .bind(newId('pay'), order.id, provider.id, providerOrderId, order.total, 'created', JSON.stringify(payload)).run();
}

async function checkoutResult(env: Env, o: OrderRow, settings: Awaited<ReturnType<typeof getSettings>>): Promise<CheckoutResult> {
  const { email: _e, phone: _p, ...order } = await toPublicOrder(env.DB, o);
  const base = { order, accessToken: o.access_token };
  if (o.status === 'pending_payment' && o.payment_method === 'upi') {
    const { vpa, payeeName } = settings.payments.upi;
    return { ...base, next: { type: 'upi', upiUri: upiUri({ vpa, payee: payeeName || settings.store.name, amount: o.total, number: o.number }), payee: vpa, amount: o.total, holdUntil: o.hold_expires_at ?? '' } };
  }
  if (o.status === 'pending_payment' && o.payment_method === 'gateway') {
    const p = await first<{ provider: string; raw: string }>(env.DB, "SELECT provider, raw FROM payments WHERE order_id = ? AND status IN ('created','failed') ORDER BY created_at DESC LIMIT 1", o.id);
    if (p) return { ...base, next: { type: 'gateway', provider: p.provider, payload: JSON.parse(p.raw), holdUntil: o.hold_expires_at ?? '' } };
  }
  if (o.payment_method === 'whatsapp' && o.status !== 'cancelled') {
    return { ...base, next: { type: 'whatsapp', url: whatsappOrderUrl(settings.store.whatsapp, order) } };
  }
  return { ...base, next: { type: 'confirmation' } };
}

export function whatsappOrderUrl(whatsapp: string, o: Pick<PublicOrder, 'number' | 'items' | 'total' | 'customerName'>) {
  const digits = whatsapp.replace(/\D/g, '');
  const phone = digits.length === 10 ? `91${digits}` : digits;
  const lines = o.items.map((i) => `• ${i.title} (${i.optionLabel}) × ${i.qty}`).join('\n');
  const text = `Hi Femia! I'd like to place order ${o.number}.\n${lines}\nTotal: ${formatINR(o.total)}\nName: ${o.customerName}`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}

// ──────────────────────────────── payment ────────────────────────────────

export async function markPaid(env: Env, ctx: Ctx, o: OrderRow, actor: string, ref?: { provider: string; providerOrderId?: string; providerPaymentId?: string | null }) {
  const db = env.DB;
  if (o.payment_status === 'paid') return o;
  const items = await orderItems(db, o.id);
  const lines = items.map((i) => ({ variantId: i.variant_id, qty: i.qty }));
  const paidAt = nowIso();
  const paymentStmt = ref?.providerOrderId
    ? [db.prepare("UPDATE payments SET status = 'paid', provider_payment_id = ?, updated_at = ? WHERE provider = ? AND provider_order_id = ?").bind(ref.providerPaymentId ?? null, paidAt, ref.provider, ref.providerOrderId)]
    : [];
  const label = o.payment_method === 'upi' ? 'UPI payment received' : 'Payment received';

  let stockProblem = false;
  if (o.stock_state === 'held') {
    const res = await db.batch([
      ...commitHeldStatements(db, o.id, lines, actor),
      db.prepare(`UPDATE orders SET payment_status = 'paid', paid_at = ?, stock_state = 'committed', hold_expires_at = NULL,
                  status = CASE WHEN status = 'pending_payment' THEN 'new' ELSE status END, updated_at = ? WHERE id = ? AND stock_state = 'held'`).bind(paidAt, paidAt, o.id),
      ...paymentStmt,
    ]);
    const orderUpdate = res[lines.length * 2];
    if (!orderUpdate?.meta.changes) return markPaid(env, ctx, (await getOrderRow(db, { id: o.id }))!, actor, ref); // hold expired meanwhile
    await db.batch([event(db, o.id, 'paid', label, actor), audit(db, actor, 'order.paid', 'order', o.id, `${o.number} marked paid`)]);
  } else {
    // Committed already (COD/manual), or the hold was released before payment arrived: try to sell again.
    const resell = o.stock_state === 'released' ? commitDirectStatements(db, o.id, lines, actor) : [];
    const finish = [
      db.prepare(`UPDATE orders SET payment_status = 'paid', paid_at = ?, stock_state = 'committed', cancel_reason = NULL,
                  status = CASE WHEN status IN ('pending_payment','cancelled') THEN 'new' ELSE status END, updated_at = ? WHERE id = ?`).bind(paidAt, paidAt, o.id),
      ...paymentStmt, event(db, o.id, 'paid', label, actor), audit(db, actor, 'order.paid', 'order', o.id, `${o.number} marked paid`),
    ];
    try {
      await db.batch([...resell, ...finish]);
    } catch (e) {
      if (!isConstraintError(e)) throw e;
      stockProblem = true; // paid after the hold expired and the stock was sold: owner must refund or substitute
      await db.batch([
        db.prepare(`UPDATE orders SET payment_status = 'paid', paid_at = ?, status = 'new', cancel_reason = NULL, updated_at = ?,
                    notes = notes || ? WHERE id = ?`).bind(paidAt, paidAt, '\n⚠ Paid after the hold expired and an item sold out. Refund or offer a substitute.', o.id),
        ...paymentStmt, event(db, o.id, 'paid', label, actor), event(db, o.id, 'stock_issue', 'Paid after hold expired; item sold out', 'system', false),
      ]);
    }
  }

  const fresh = (await getOrderRow(db, { id: o.id }))!;
  ctx.waitUntil((async () => {
    const pub = await toPublicOrder(db, fresh);
    await notifyOrder(env, pub, 'received');
    if (o.payment_method === 'gateway' || stockProblem) await notifyOrder(env, pub, 'owner_new');
  })());
  return fresh;
}

export async function markPaymentFailed(env: Env, ctx: Ctx, o: OrderRow, providerOrderId: string) {
  if (o.payment_status === 'paid') return;
  await env.DB.batch([
    env.DB.prepare("UPDATE payments SET status = 'failed', updated_at = ? WHERE provider_order_id = ? AND status != 'paid'").bind(nowIso(), providerOrderId),
    env.DB.prepare("UPDATE orders SET payment_status = 'failed', updated_at = ? WHERE id = ? AND payment_status = 'unpaid'").bind(nowIso(), o.id),
    event(env.DB, o.id, 'payment_failed', 'Payment did not go through', 'gateway'),
  ]);
  ctx.waitUntil(toPublicOrder(env.DB, o).then((pub) => notifyOrder(env, pub, 'owner_failed')));
}

// ──────────────────────────────── status ────────────────────────────────

export async function cancelOrder(env: Env, ctx: Ctx, o: OrderRow, actor: string, reason: string, isPublic = true) {
  const db = env.DB;
  const items = await orderItems(db, o.id);
  const lines = items.map((i) => ({ variantId: i.variant_id, qty: i.qty }));
  const stock = o.stock_state === 'held' ? releaseHeldStatements(db, o.id, lines, actor, reason)
    : o.stock_state === 'committed' ? restockStatements(db, o.id, lines, actor, reason) : [];
  await db.batch([
    ...stock,
    db.prepare("UPDATE orders SET status = 'cancelled', stock_state = 'released', hold_expires_at = NULL, cancel_reason = ?, updated_at = ? WHERE id = ? AND stock_state = ?")
      .bind(reason, nowIso(), o.id, o.stock_state),
    event(db, o.id, 'cancelled', isPublic ? reason : null, actor),
    audit(db, actor, 'order.cancel', 'order', o.id, `${o.number} cancelled: ${reason}`),
  ]);
  void ctx;
}

export interface TransitionInput { to: OrderStatus; note?: string; courier?: string; trackingNumber?: string; trackingUrl?: string; reason?: string }

export async function transitionOrder(env: Env, ctx: Ctx, number: string, input: TransitionInput, actor: string) {
  const db = env.DB;
  const o = await getOrderRow(db, { number });
  if (!o) throw notFound('Order not found');
  if (!canTransition(o.status, input.to)) throw conflict('bad_transition', `An order that is ${o.status.replace('_', ' ')} can't move to ${input.to}.`);

  if (input.to === 'cancelled') {
    await cancelOrder(env, ctx, o, actor, input.reason || 'Cancelled by store');
  } else {
    const stmts: D1PreparedStatement[] = [];
    const now = nowIso();
    if (input.to === 'confirmed' && o.stock_state === 'held') {
      const items = await orderItems(db, o.id);
      stmts.push(...commitHeldStatements(db, o.id, items.map((i) => ({ variantId: i.variant_id, qty: i.qty })), actor));
      stmts.push(db.prepare("UPDATE orders SET stock_state = 'committed', hold_expires_at = NULL WHERE id = ?").bind(o.id));
    }
    if (input.to === 'shipped') {
      if (!input.courier) throw new HttpError(422, 'validation', 'Add the courier name before marking as shipped', { fields: { courier: 'Required' } });
      stmts.push(db.prepare('UPDATE orders SET courier = ?, tracking_number = ?, tracking_url = ? WHERE id = ?')
        .bind(input.courier, input.trackingNumber ?? null, input.trackingUrl ?? null, o.id));
    }
    if (input.to === 'delivered' && o.payment_status === 'cod') {
      stmts.push(db.prepare("UPDATE orders SET payment_status = 'paid', paid_at = ? WHERE id = ?").bind(now, o.id));
    }
    const notes: Partial<Record<OrderStatus, string>> = {
      confirmed: 'Order confirmed', packed: 'Packed and ready to ship',
      shipped: `Shipped with ${input.courier ?? 'courier'}${input.trackingNumber ? ` · ${input.trackingNumber}` : ''}`, delivered: 'Delivered',
    };
    stmts.push(
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?').bind(input.to, now, o.id, o.status),
      event(db, o.id, input.to, notes[input.to] ?? null, actor),
      ...(input.note ? [event(db, o.id, 'note', input.note, actor, false)] : []),
      audit(db, actor, `order.${input.to}`, 'order', o.id, `${o.number} → ${input.to}`),
    );
    try { await db.batch(stmts); } catch (e) {
      if (isConstraintError(e)) throw conflict('insufficient_stock', 'Not enough stock to confirm this order. Update stock or cancel the order.');
      throw e;
    }
  }

  const fresh = (await getOrderRow(db, { id: o.id }))!;
  if (input.to === 'confirmed' || input.to === 'shipped' || input.to === 'delivered') {
    ctx.waitUntil(toPublicOrder(db, fresh).then((pub) => notifyOrder(env, pub, input.to as 'confirmed' | 'shipped' | 'delivered')));
  }
  return fresh;
}

/** Cron: cancel orders whose payment hold expired and give the stock back. */
export async function releaseExpiredHolds(env: Env, ctx: Ctx) {
  const expired = await all<OrderRow>(env.DB, "SELECT * FROM orders WHERE stock_state = 'held' AND hold_expires_at < ? LIMIT 100", nowIso());
  for (const o of expired) {
    await cancelOrder(env, ctx, o, 'system', o.payment_method === 'whatsapp' ? 'Not confirmed in time' : 'Payment not received in time');
  }
  return expired.length;
}

export const shipToLabel = (codes: string[]) => codes.map((c) => STATE_PINCODES[c as 'KL']?.name ?? c).join(', ');

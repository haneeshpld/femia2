import {
  CUSTOMER_CANCELLABLE,
  bestSale, canShipTo, canTransition, CheckoutRequest, formatINR, quoteCart, STATE_PINCODES, type ScopeItem,
  type CheckoutResult, type OrderChannel, type OrderStatus, type PaymentMethod, type PricedVariant, type PublicOrder, type Quote,
} from '@femia/contracts';
import type { Env } from '../env.ts';
import { all, audit, first, isConstraintError, newId, nowIso, placeholders, token } from '../lib/db.ts';
import { conflict, HttpError, notFound, parse } from '../lib/http.ts';
import { notifyLowStock, notifyOrder, sendTelegram } from '../notify/index.ts';
import { safeEqual } from '../lib/crypto.ts';
import { listRefunds, refundable, startRefund } from './refunds.ts';
import { getGatewayKeys, getProvider, upiUri } from '../payments/index.ts';
import { getSettings } from './settings.ts';
import { automaticOffers, checkCoupon } from './offers.ts';
import {
  commitDirectStatements, commitHeldStatements, holdStatements, releaseHeldStatements, resellReleasedStatements, restockStatements, type StockLine,
} from './stock.ts';
import { escHtml } from '../notify/index.ts';

type Ctx = { waitUntil(p: Promise<unknown>): void };

/** Razorpay (and most gateways) won't take less than ₹1. */
const MIN_ONLINE_AMOUNT = 100;
/** Unpaid online/UPI orders one mobile number can have holding stock at once (stops one person locking up the shop). */
const MAX_OPEN_HOLDS_PER_PHONE = 3;

// Conditional writes: each runs only while `cond` is still true, so a batch that lost a race writes nothing.
const eventIf = (db: D1Database, orderId: string, status: string, note: string | null, actor: string, isPublic: boolean, cond: string, ...condBinds: unknown[]) =>
  db.prepare(`INSERT INTO order_events (order_id, status, note, actor, public) SELECT ?,?,?,?,? WHERE ${cond}`).bind(orderId, status, note, actor, isPublic ? 1 : 0, ...condBinds);
const auditIf = (db: D1Database, actor: string, action: string, entityId: string, summary: string, cond: string, ...condBinds: unknown[]) =>
  db.prepare(`INSERT INTO audit_log (actor, action, entity, entity_id, summary) SELECT ?,?,'order',?,? WHERE ${cond}`).bind(actor, action, entityId, summary, ...condBinds);
/** The order hasn't been paid yet (a refunded order was paid once and must never be "paid" again). */
const UNPAID = "EXISTS (SELECT 1 FROM orders WHERE id = ? AND payment_status NOT IN ('paid','refunded'))";
const UNPAID_IN = "EXISTS (SELECT 1 FROM orders WHERE id = ? AND payment_status NOT IN ('paid','refunded') AND stock_state = ?)";
const isPaid = (s: string) => s === 'paid' || s === 'refunded';

// ───────────────────────────────── pricing ─────────────────────────────────

export async function loadPricedVariants(db: D1Database, ids: string[]): Promise<Map<string, PricedVariant>> {
  const unique = [...new Set(ids)].slice(0, 60);
  if (!unique.length) return new Map();
  const rows = await all<{
    id: string; product_id: string; slug: string; title: string; option1: string | null; option2: string | null; option2_label: string | null;
    price: number; compare_at_price: number | null; available: number; purchasable: number; image_key: string | null; category_id: string;
  }>(db,
    `SELECT v.id, v.product_id, p.slug, p.title, v.option1, v.option2, p.category_id,
            (SELECT label FROM product_options po WHERE po.product_id = p.id AND po.option = 2 AND po.value = v.option2) AS option2_label,
            COALESCE(v.price, p.price) AS price, COALESCE(v.compare_at_price, p.compare_at_price) AS compare_at_price,
            MAX(v.on_hand - v.reserved, 0) AS available,
            (v.active = 1 AND p.status = 'active') AS purchasable,
            (SELECT m.key_base FROM product_media pm JOIN media m ON m.id = pm.media_id
              WHERE pm.product_id = p.id AND (pm.option2 = v.option2 OR pm.option2 IS NULL)
              ORDER BY (pm.option2 IS NULL), (pm.role != 'main'), pm.sort LIMIT 1) AS image_key
     FROM variants v JOIN products p ON p.id = v.product_id WHERE v.id IN (${placeholders(unique.length)})`, ...unique);
  const productIds = [...new Set(rows.map((r) => r.product_id))];
  const [colls, offers] = await Promise.all([
    productIds.length ? all<{ product_id: string; collection_id: string }>(db, `SELECT product_id, collection_id FROM product_collections WHERE product_id IN (${placeholders(productIds.length)})`, ...productIds) : [],
    automaticOffers(db),
  ]);
  const collsBy = new Map<string, string[]>();
  for (const c of colls) (collsBy.get(c.product_id) ?? collsBy.set(c.product_id, []).get(c.product_id)!).push(c.collection_id);
  return new Map(rows.map((r) => {
    const scope: ScopeItem = { productId: r.product_id, categoryId: r.category_id, collectionIds: collsBy.get(r.product_id) ?? [] };
    const sale = bestSale(r.price, scope, offers);
    return [r.id, {
      variantId: r.id, productId: r.product_id, slug: r.slug, title: r.title, option1: r.option1, option2: r.option2,
      optionLabel: [r.option1, r.option2_label ?? r.option2].filter(Boolean).join(' / '),
      imageUrl: r.image_key ? `/media/${r.image_key}/480.webp` : null,
      price: sale ? sale.price : r.price,
      compareAtPrice: sale ? Math.max(r.compare_at_price ?? 0, r.price) : r.compare_at_price,
      listPrice: r.price, saleLabel: sale?.offer.label ?? null, scope,
      available: r.available, purchasable: r.purchasable === 1,
    }];
  }));
}

/** Server-side quote: sale prices, the best bundle, and a coupon (checked against usage and first-order rules). */
export async function quote(db: D1Database, lines: { variantId: string; qty: number }[], opts: { coupon?: string | null; phone?: string | null; customerId?: string | null; email?: string | null } = {}): Promise<Quote> {
  const [variants, settings, offers, c] = await Promise.all([
    loadPricedVariants(db, lines.map((l) => l.variantId)), getSettings(db), automaticOffers(db), checkCoupon(db, opts.coupon, { phone: opts.phone, customerId: opts.customerId, email: opts.email }),
  ]);
  return quoteCart(lines, variants, settings.shipping, { offers, coupon: c.coupon, couponCode: c.code, couponError: c.error });
}

// ──────────────────────────────── reading ────────────────────────────────

interface OrderRow {
  id: string; number: string; access_token: string; status: OrderStatus; payment_method: PaymentMethod; payment_status: PublicOrder['paymentStatus'];
  channel: OrderChannel; stock_state: 'held' | 'committed' | 'released'; hold_expires_at: string | null;
  customer_name: string; phone: string; email: string; line1: string; line2: string; landmark: string; city: string; state: string; pincode: string;
  subtotal: number; discount: number; shipping: number; total: number; courier: string | null; tracking_number: string | null; tracking_url: string | null;
  notes: string; cancel_reason: string | null; cancelled_by: string | null; created_at: string; paid_at: string | null;
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
  const [items, events, discounts, pay, refunds] = await Promise.all([
    orderItems(db, o.id),
    all<{ status: string; note: string | null; created_at: string }>(db, 'SELECT status, note, created_at FROM order_events WHERE order_id = ? AND public = 1 ORDER BY id', o.id),
    all<{ label: string; code: string | null; amount: number }>(db, 'SELECT label, code, amount FROM order_discounts WHERE order_id = ? ORDER BY id', o.id),
    first<{ provider: string; provider_order_id: string | null; provider_payment_id: string | null; instrument: string | null }>(db,
      "SELECT provider, provider_order_id, provider_payment_id, instrument FROM payments WHERE order_id = ? ORDER BY CASE status WHEN 'paid' THEN 0 ELSE 1 END, created_at DESC LIMIT 1", o.id),
    listRefunds(db, o.id),
  ]);
  return {
    number: o.number, status: o.status, paymentMethod: o.payment_method, paymentStatus: o.payment_status,
    items: items.map((i) => ({
      variantId: i.variant_id, productId: i.product_id, slug: i.slug, title: i.title, optionLabel: i.option_label, sku: i.sku,
      imageUrl: i.image_url, unitPrice: i.unit_price, qty: i.qty, lineTotal: i.line_total,
    })),
    subtotal: o.subtotal, discount: o.discount ?? 0, discounts, shipping: o.shipping, total: o.total, customerName: o.customer_name, city: o.city, pincode: o.pincode,
    courier: o.courier, trackingNumber: o.tracking_number, trackingUrl: o.tracking_url,
    timeline: events.map((e) => ({ status: e.status, note: e.note, at: e.created_at })),
    createdAt: o.created_at, email: o.email, phone: o.phone,
    payment: {
      method: o.payment_method, status: o.payment_status, amount: o.total, provider: pay?.provider ?? null,
      reference: pay?.provider_payment_id ?? null, gatewayOrderId: pay?.provider_order_id ?? null, paidAt: o.paid_at, instrument: pay?.instrument ?? null,
    },
    refunds: refunds.map((r) => ({ amount: r.amount, status: r.status, reference: r.provider_refund_id ?? r.reference, toOriginal: !!r.provider, createdAt: r.created_at, processedAt: r.processed_at })),
    canCancel: CUSTOMER_CANCELLABLE.includes(o.status),
    cancelledBy: o.cancelled_by,
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
  /** the signed-in shopper placing the order */
  customerId?: string | null;
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
  // Online, UPI goes through Razorpay (instant confirmation, automatic refunds): checkout offers it as a Razorpay
  // option, and a page that still sends "upi" gets Razorpay opened on UPI. Only a shop without Razorpay but with
  // an older direct-UPI setup (pay to the shop's UPI ID, confirmed by staff) keeps that flow.
  const directUpi = settings.payments.upi.enabled && !!settings.payments.upi.vpa;
  const viaGateway = !opts.manual && req.paymentMethod === 'upi' && settings.payments.gateway.enabled && !!(await getGatewayKeys(env, settings.payments.gateway.provider));
  const method: PaymentMethod = viaGateway ? 'gateway' : req.paymentMethod;
  const payWith = method === 'gateway' ? (req.paymentMethod === 'upi' ? 'upi' : req.payWith ?? null) : null;
  if (!opts.manual) {
    const enabled = {
      upi: directUpi,
      gateway: settings.payments.gateway.enabled,
      cod: settings.shipping.cod.enabled,
      whatsapp: settings.payments.whatsapp.enabled && !!settings.store.whatsapp,
    }[method];
    if (!enabled) throw new HttpError(422, 'method_unavailable', 'That payment option is not available right now. Please choose another.');
  }

  const q = await quote(db, req.lines, { coupon: req.coupon, phone: req.customer.phone, customerId: opts.customerId, email: req.customer.email });
  if (q.issues.length || !q.lines.length) throw conflict('cart_changed', 'Some items in your bag have changed. Please review and try again.', { quote: q });
  if (q.coupon && !q.coupon.applied) throw new HttpError(422, 'coupon_invalid', q.coupon.message, { quote: q });
  if (!opts.manual && method === 'cod' && settings.shipping.cod.maxOrderValue !== null && q.total > settings.shipping.cod.maxOrderValue) {
    throw new HttpError(422, 'cod_limit', `Cash on Delivery is available for orders up to ${formatINR(settings.shipping.cod.maxOrderValue)}. Please choose another payment option.`);
  }
  if (!opts.manual && (method === 'gateway' || method === 'upi') && q.total < MIN_ONLINE_AMOUNT) {
    throw new HttpError(422, 'amount_too_small', `Online payment needs an order of at least ${formatINR(MIN_ONLINE_AMOUNT)}. Please choose Cash on Delivery or add another piece.`, { quote: q });
  }
  if (!opts.manual && method !== 'cod') {
    // only live holds: an expired one is about to be released (or is waiting for the gateway to answer)
    const open = await first<{ n: number }>(db, "SELECT COUNT(*) AS n FROM orders WHERE phone = ? AND stock_state = 'held' AND status IN ('pending_payment','new') AND hold_expires_at > ?", req.customer.phone, nowIso());
    if ((open?.n ?? 0) >= MAX_OPEN_HOLDS_PER_PHONE) {
      throw new HttpError(429, 'too_many_unpaid', 'You already have orders waiting for payment. Please complete one from its order page (or cancel it there) before placing another.');
    }
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
         customer_name, phone, email, line1, line2, landmark, city, state, pincode, subtotal, discount, shipping, total, notes, created_by, paid_at, customer_id)
       VALUES (?, 'FEM' || (SELECT value FROM counters WHERE name = 'order_number'), ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,
         COALESCE(?, (SELECT id FROM customers WHERE email = lower(?) AND disabled = 0)))`,
    ).bind(
      orderId, token(), req.clientRef, status, method, paymentStatus, opts.channel ?? 'web', stockState, holdUntil,
      req.customer.name, req.customer.phone, req.customer.email, req.address.line1, req.address.line2, req.address.landmark,
      req.address.city, req.address.state, req.address.pincode, q.subtotal, q.discountTotal, q.shipping, q.total, opts.manual?.note ?? '',
      opts.createdBy ?? null, paymentStatus === 'paid' ? new Date(now).toISOString() : null, opts.customerId ?? null, req.customer.email,
    ),
    ...q.lines.map((l) => db.prepare(
      `INSERT INTO order_items (order_id, variant_id, product_id, slug, sku, title, option_label, image_url, unit_price, list_price, qty, line_total)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(orderId, l.variantId, l.productId, l.slug, skuOf.get(l.variantId) ?? '', l.title, l.optionLabel, l.imageUrl, l.price, l.listPrice ?? l.price, l.qty, l.lineTotal)),
    // What the shopper got, kept with the order; coupons count a use.
    ...q.discounts.flatMap((d) => [
      db.prepare('INSERT INTO order_discounts (order_id, offer_id, kind, label, code, amount, customer_id) VALUES (?,?,?,?,?,?,(SELECT customer_id FROM orders WHERE id = ?))').bind(orderId, d.offerId, d.kind, d.label, d.code, d.amount, orderId),
      ...(d.kind === 'coupon' ? [db.prepare('UPDATE offers SET used_count = used_count + 1 WHERE id = ?').bind(d.offerId)] : []),
    ]),
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
      const q2 = await quote(db, req.lines, { coupon: req.coupon, phone: req.customer.phone, customerId: opts.customerId, email: req.customer.email });
      if (q2.coupon && !q2.coupon.applied) throw new HttpError(422, 'coupon_invalid', q2.coupon.message, { quote: q2 }); // last use just went
      throw conflict('cart_changed', 'Someone just bought the last piece of an item in your bag. Please review and try again.', { quote: q2 });
    }
    throw e;
  }

  let order = (await getOrderRow(db, { id: orderId }))!;

  if (method === 'gateway' && !opts.manual) {
    try {
      await startGatewayPayment(env, order, settings.store.name, payWith);
    } catch (e) {
      console.error('gateway create failed', e);
      await cancelOrder(env, ctx, order, 'system', 'Payment gateway unavailable', false);
      throw new HttpError(502, 'gateway_unavailable', 'Online payment is not responding right now. Please try again in a minute, or choose Cash on Delivery.');
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

async function startGatewayPayment(env: Env, order: OrderRow, storeName: string, payWith: 'upi' | 'other' | null = null) {
  const settings = await getSettings(env.DB);
  const provider = getProvider(settings.payments.gateway.provider);
  const keys = await getGatewayKeys(env, provider.id);
  if (!keys) throw new Error('gateway keys missing');
  const { providerOrderId, payload } = await provider.createOrder(
    { orderId: order.id, number: order.number, amount: order.total, customer: { name: order.customer_name, email: order.email, phone: order.phone }, storeName, payWith },
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

/**
 * Record a payment. Safe to call several times at once for the same order (the browser return, Razorpay's
 * payment.captured and order.paid webhooks, the 5-minute check): every write is conditional on the order still
 * being unpaid, so stock, refunds, events and notifications happen exactly once.
 */
export async function markPaid(env: Env, ctx: Ctx, o: OrderRow, actor: string, ref?: { provider: string; providerOrderId?: string; providerPaymentId?: string | null; instrument?: string | null }): Promise<OrderRow> {
  const db = env.DB;
  if (isPaid(o.payment_status)) {
    // Already confirmed (e.g. by the browser): a later webhook can still tell us it was UPI / card.
    if (ref?.providerOrderId && ref.instrument) await db.prepare('UPDATE payments SET instrument = ? WHERE provider = ? AND provider_order_id = ? AND instrument IS NULL').bind(ref.instrument, ref.provider, ref.providerOrderId).run();
    return o;
  }
  if (o.status === 'cancelled' && o.cancelled_by === 'customer') {
    // They cancelled before the payment landed: keep the order cancelled and send the money straight back.
    const at = nowIso();
    const res = await db.batch([
      ...(ref?.providerOrderId ? [db.prepare("UPDATE payments SET status = 'paid', provider_payment_id = ?, instrument = COALESCE(?, instrument), updated_at = ? WHERE provider = ? AND provider_order_id = ?").bind(ref.providerPaymentId ?? null, ref.instrument ?? null, at, ref.provider, ref.providerOrderId)] : []),
      eventIf(db, o.id, 'paid', 'Payment arrived after you cancelled', actor, true, UNPAID, o.id),
      db.prepare("UPDATE orders SET payment_status = 'paid', paid_at = ?, updated_at = ? WHERE id = ? AND payment_status NOT IN ('paid','refunded')").bind(at, at, o.id),
    ]);
    const fresh = (await getOrderRow(db, { id: o.id }))!;
    if (!res.at(-1)!.meta.changes) return fresh; // another confirmation got here first and started the refund
    await startRefund(env, ctx, fresh, { amount: fresh.total, reason: 'Paid after the order was cancelled', by: 'system' });
    return (await getOrderRow(db, { id: o.id }))!;
  }
  const items = await orderItems(db, o.id);
  const lines = items.map((i) => ({ variantId: i.variant_id, qty: i.qty }));
  const paidAt = nowIso();
  const paymentStmt = ref?.providerOrderId
    ? [db.prepare("UPDATE payments SET status = 'paid', provider_payment_id = ?, instrument = COALESCE(?, instrument), updated_at = ? WHERE provider = ? AND provider_order_id = ?").bind(ref.providerPaymentId ?? null, ref.instrument ?? null, paidAt, ref.provider, ref.providerOrderId)]
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
    // Every write is conditional on the order still being unpaid in the state we read (see markPaid's comment).
    const resell = o.stock_state === 'released' ? resellReleasedStatements(db, o.id, lines, actor) : [];
    const finish = [
      ...paymentStmt,
      eventIf(db, o.id, 'paid', label, actor, true, UNPAID_IN, o.id, o.stock_state),
      auditIf(db, actor, 'order.paid', o.id, `${o.number} marked paid`, UNPAID_IN, o.id, o.stock_state),
      db.prepare(`UPDATE orders SET payment_status = 'paid', paid_at = ?, stock_state = 'committed', cancel_reason = NULL,
                  status = CASE WHEN status IN ('pending_payment','cancelled') THEN 'new' ELSE status END, updated_at = ?
                  WHERE id = ? AND payment_status NOT IN ('paid','refunded') AND stock_state = ?`).bind(paidAt, paidAt, o.id, o.stock_state),
    ];
    let res: D1Result[];
    try {
      res = await db.batch([...resell, ...finish]);
    } catch (e) {
      if (!isConstraintError(e)) throw e;
      stockProblem = true; // paid after the hold expired and the stock was sold: owner must refund or substitute
      res = await db.batch([
        ...paymentStmt,
        eventIf(db, o.id, 'paid', label, actor, true, UNPAID, o.id),
        eventIf(db, o.id, 'stock_issue', 'Paid after hold expired; item sold out', 'system', false, UNPAID, o.id),
        db.prepare(`UPDATE orders SET payment_status = 'paid', paid_at = ?, status = 'new', cancel_reason = NULL, updated_at = ?,
                    notes = notes || ? WHERE id = ? AND payment_status NOT IN ('paid','refunded')`).bind(paidAt, paidAt, '\n⚠ Paid after the hold expired and an item sold out. Refund or offer a substitute.', o.id),
      ]);
    }
    // Lost a race (another confirmation, or the order changed meanwhile): start again from what's there now.
    if (!res.at(-1)!.meta.changes) return markPaid(env, ctx, (await getOrderRow(db, { id: o.id }))!, actor, ref);
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

/**
 * Cancel an order and give its stock back. Returns false when nothing changed because the order was cancelled or
 * changed by someone else meanwhile (double tap, staff and shopper at once, a payment landing): every write is
 * conditional on the order still being in the state we read, so stock and coupon uses come back exactly once.
 */
export async function cancelOrder(env: Env, ctx: Ctx, o: OrderRow, actor: string, reason: string, isPublic = true, by: 'customer' | 'store' | 'system' = actor === 'system' ? 'system' : 'store'): Promise<boolean> {
  const db = env.DB;
  if (o.status === 'cancelled') return false;
  const items = await orderItems(db, o.id);
  const lines = items.map((i) => ({ variantId: i.variant_id, qty: i.qty }));
  const stock = o.stock_state === 'held' ? releaseHeldStatements(db, o.id, lines, actor, reason)
    : o.stock_state === 'committed' ? restockStatements(db, o.id, lines, actor, reason) : [];
  const STILL = "EXISTS (SELECT 1 FROM orders WHERE id = ? AND status != 'cancelled' AND stock_state = ?)";
  const res = await db.batch([
    ...stock,
    // a cancelled order gives its coupon use back
    db.prepare(`UPDATE offers SET used_count = MAX(used_count - 1, 0) WHERE id IN (SELECT offer_id FROM order_discounts WHERE order_id = ? AND kind = 'coupon')
      AND ${STILL}`).bind(o.id, o.id, o.stock_state),
    eventIf(db, o.id, 'cancelled', isPublic ? reason : null, actor, true, STILL, o.id, o.stock_state),
    auditIf(db, actor, 'order.cancel', o.id, `${o.number} cancelled: ${reason}`, STILL, o.id, o.stock_state),
    // last: everything above checks the state this changes
    db.prepare("UPDATE orders SET status = 'cancelled', stock_state = 'released', hold_expires_at = NULL, cancel_reason = ?, cancelled_by = ?, updated_at = ? WHERE id = ? AND stock_state = ? AND status != 'cancelled'")
      .bind(reason, by, nowIso(), o.id, o.stock_state),
  ]);
  void ctx;
  return !!res.at(-1)!.meta.changes;
}

/** After a cancel that didn't apply: say why, from the order as it is now. */
async function cancelConflict(db: D1Database, orderId: string) {
  const now = await getOrderRow(db, { id: orderId });
  return now?.status === 'cancelled'
    ? conflict('already_cancelled', 'This order is already cancelled.')
    : conflict('order_changed', 'This order was just updated (a payment may have arrived). Please refresh and try again.');
}

export interface TransitionInput { to: OrderStatus; note?: string; courier?: string; trackingNumber?: string; trackingUrl?: string; reason?: string; refund?: boolean }

export async function transitionOrder(env: Env, ctx: Ctx, number: string, input: TransitionInput, actor: string) {
  const db = env.DB;
  const o = await getOrderRow(db, { number });
  if (!o) throw notFound('Order not found');
  // Tapped twice (or a colleague got there first): it's already where they wanted it. Nothing to do, nothing to email.
  if (o.status === input.to && input.to !== 'cancelled') return o;
  if (!canTransition(o.status, input.to)) throw conflict('bad_transition', `An order that is ${o.status.replace('_', ' ')} can't move to ${input.to}.`);

  if (input.to === 'cancelled') {
    if (!(await cancelOrder(env, ctx, o, actor, input.reason || 'Cancelled by store'))) throw await cancelConflict(db, o.id);
    // A paid order gets its money back (Razorpay automatically; UPI/cash recorded for the owner to send).
    if (input.refund !== false && o.payment_status === 'paid') {
      const left = await refundable(db, o);
      if (left > 0) await startRefund(env, ctx, o, { amount: left, reason: input.reason || 'Order cancelled by store', by: actor });
    }
    ctx.waitUntil((async () => { const pub = await toPublicOrder(db, (await getOrderRow(db, { id: o.id }))!); await notifyOrder(env, pub, 'cancelled'); })());
  } else {
    // Every write runs only while the order is still in the status we read, and the status itself changes last.
    // Two taps, two people, or the shopper cancelling at the same moment: one of them wins, the other writes
    // nothing (no second timeline entry, no "shipped" email for an order that was just cancelled).
    const STILL = 'EXISTS (SELECT 1 FROM orders WHERE id = ? AND status = ?)';
    const stmts: D1PreparedStatement[] = [];
    const now = nowIso();
    if (input.to === 'confirmed' && o.stock_state === 'held') {
      const items = await orderItems(db, o.id);
      stmts.push(...commitHeldStatements(db, o.id, items.map((i) => ({ variantId: i.variant_id, qty: i.qty })), actor));
      stmts.push(db.prepare("UPDATE orders SET stock_state = 'committed', hold_expires_at = NULL WHERE id = ? AND status = ? AND stock_state = 'held'").bind(o.id, o.status));
    }
    if (input.to === 'shipped') {
      if (!input.courier) throw new HttpError(422, 'validation', 'Add the courier name before marking as shipped', { fields: { courier: 'Required' } });
      stmts.push(db.prepare('UPDATE orders SET courier = ?, tracking_number = ?, tracking_url = ? WHERE id = ? AND status = ?')
        .bind(input.courier, input.trackingNumber ?? null, input.trackingUrl ?? null, o.id, o.status));
    }
    if (input.to === 'delivered' && o.payment_status === 'cod') {
      stmts.push(db.prepare("UPDATE orders SET payment_status = 'paid', paid_at = ? WHERE id = ? AND status = ? AND payment_status = 'cod'").bind(now, o.id, o.status));
    }
    const notes: Partial<Record<OrderStatus, string>> = {
      confirmed: 'Order confirmed', packed: 'Packed and ready to ship',
      shipped: `Shipped with ${input.courier ?? 'courier'}${input.trackingNumber ? ` · ${input.trackingNumber}` : ''}`, delivered: 'Delivered',
    };
    stmts.push(
      eventIf(db, o.id, input.to, notes[input.to] ?? null, actor, true, STILL, o.id, o.status),
      ...(input.note ? [eventIf(db, o.id, 'note', input.note, actor, false, STILL, o.id, o.status)] : []),
      auditIf(db, actor, `order.${input.to}`, o.id, `${o.number} → ${input.to}`, STILL, o.id, o.status),
      // last: everything above checks the status this changes
      db.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?').bind(input.to, now, o.id, o.status),
    );
    let res: D1Result[];
    try { res = await db.batch(stmts); } catch (e) {
      if (isConstraintError(e)) throw conflict('insufficient_stock', 'Not enough stock to confirm this order. Update stock or cancel the order.');
      throw e;
    }
    if (!res.at(-1)!.meta.changes) {
      const current = (await getOrderRow(db, { id: o.id }))!;
      if (current.status === input.to) return current; // someone else just did the same thing
      throw conflict('order_changed', current.status === 'cancelled' ? 'This order was just cancelled. Refresh to see it.' : 'This order was just updated by someone else. Refresh and try again.');
    }
  }

  const fresh = (await getOrderRow(db, { id: o.id }))!;
  if (input.to === 'confirmed' || input.to === 'shipped' || input.to === 'delivered') {
    ctx.waitUntil(toPublicOrder(db, fresh).then((pub) => notifyOrder(env, pub, input.to as 'confirmed' | 'shipped' | 'delivered')));
  }
  return fresh;
}

/** Cron: cancel orders whose payment hold expired and give the stock back. */
/**
 * Ask the payment gateway whether an online order was paid, and record it if so. Used when a webhook was missed
 * (and always on a laptop, where webhooks can't reach you), before a hold is released, and from Admin.
 */
export async function reconcileGatewayOrder(env: Env, ctx: Ctx, o: OrderRow): Promise<'paid' | 'pending' | 'not_gateway' | 'unavailable'> {
  if (o.payment_method !== 'gateway') return 'not_gateway';
  if (isPaid(o.payment_status)) return 'paid';
  const pay = await first<{ provider: string; provider_order_id: string | null; amount: number }>(env.DB,
    "SELECT provider, provider_order_id, amount FROM payments WHERE order_id = ? AND provider_order_id IS NOT NULL ORDER BY created_at DESC LIMIT 1", o.id);
  if (!pay?.provider_order_id) return 'pending';
  const keys = await getGatewayKeys(env, pay.provider);
  if (!keys) return 'pending'; // no gateway keys at all: nothing could have been paid through it
  let r: { status: 'paid' | 'pending'; providerPaymentId: string | null; instrument?: string | null };
  try { r = await getProvider(pay.provider).checkOrder(pay.provider_order_id, pay.amount, keys); }
  catch (e) { console.error('gateway check failed', o.number, e); return 'unavailable'; }
  if (r.status === 'paid') {
    await markPaid(env, ctx, o, `gateway:${pay.provider}`, { provider: pay.provider, providerOrderId: pay.provider_order_id, providerPaymentId: r.providerPaymentId, instrument: r.instrument });
    return 'paid';
  }
  return 'pending';
}

/** Every few minutes: catch online payments whose webhook hasn't arrived (oldest first, a few per run). */
export async function reconcilePendingGateway(env: Env, ctx: Ctx) {
  const rows = await all<OrderRow>(env.DB, `SELECT * FROM orders WHERE payment_method = 'gateway' AND payment_status != 'paid' AND status = 'pending_payment'
    AND created_at < ? ORDER BY created_at LIMIT 15`, new Date(Date.now() - 3 * 60e3).toISOString());
  let paid = 0;
  // One order that can't be processed must not stop the ones after it (this runs oldest first, every time).
  const check = async (o: OrderRow) => {
    try { if ((await reconcileGatewayOrder(env, ctx, o)) === 'paid') paid++; }
    catch (e) { console.error('payment check failed', o.number, e); }
  };
  for (const o of rows) await check(o);

  // Cancelled online orders can still be paid: a UPI request approved late, a payment window left open, or a
  // webhook that never arrived. Ask the gateway every 30 minutes for a day after cancelling, so money is never
  // kept without its order (markPaid refunds a shopper-cancelled order and reopens one that timed out).
  const late = await all<OrderRow & { pay_id: string }>(env.DB, `SELECT o.*, p.id AS pay_id FROM orders o JOIN payments p ON p.order_id = o.id
    WHERE o.payment_method = 'gateway' AND o.status = 'cancelled' AND o.payment_status NOT IN ('paid','refunded') AND o.updated_at > ?
      AND p.provider_order_id IS NOT NULL AND p.status != 'paid' AND p.updated_at < ?
    ORDER BY p.updated_at LIMIT 10`, new Date(Date.now() - 864e5).toISOString(), new Date(Date.now() - 30 * 60e3).toISOString());
  for (const o of late) {
    await env.DB.prepare('UPDATE payments SET updated_at = ? WHERE id = ?').bind(nowIso(), o.pay_id).run();
    await check(o);
  }
  return paid;
}

export async function releaseExpiredHolds(env: Env, ctx: Ctx) {
  const expired = await all<OrderRow>(env.DB, "SELECT * FROM orders WHERE stock_state = 'held' AND hold_expires_at < ? ORDER BY hold_expires_at LIMIT 100", nowIso());
  let released = 0;
  for (const o of expired) {
    try {
      // Never cancel an online order that was actually paid: check with the gateway first.
      const check = await reconcileGatewayOrder(env, ctx, o);
      if (check === 'paid') continue;
      // Gateway unreachable: keep the hold and try again next run, for up to a day, rather than cancel a possibly paid order.
      if (check === 'unavailable' && Date.parse(o.hold_expires_at ?? '') > Date.now() - 864e5) continue;
      if (await cancelOrder(env, ctx, o, 'system', o.payment_method === 'whatsapp' ? 'Not confirmed in time' : 'Payment not received in time')) released++;
    } catch (e) {
      // One order that can't be released must not keep every other expired hold (and its stock) stuck.
      console.error('hold release failed', o.number, e);
    }
  }
  return released;
}

export const shipToLabel = (codes: string[]) => codes.map((c) => STATE_PINCODES[c as 'KL']?.name ?? c).join(', ');

/** Why an order was set aside at checkout. Such orders never reached the shopper, so their account doesn't list them. */
export const SWITCHED_METHOD = 'Changed payment method at checkout';

/**
 * Checkout, after the shopper closed the online payment window and chose another way to pay: ask the gateway
 * first (it may have gone through), then release the unpaid online order. It counts as cancelled by the shopper,
 * so a payment that still lands later is refunded automatically.
 */
export async function releaseForOtherMethod(env: Env, ctx: Ctx, number: string, token: string): Promise<{ status: 'paid' | 'released' }> {
  const o = await getOrderRow(env.DB, { number });
  if (!o || !safeEqual(o.access_token, token)) throw notFound('Order not found');
  if (o.payment_method !== 'gateway') throw conflict('not_online', 'This order isn’t paid online.');
  if (isPaid(o.payment_status)) return { status: 'paid' };
  if (o.status !== 'pending_payment') {
    if (o.status === 'cancelled') return { status: 'released' }; // already out of the way (hold expired, double tap)
    throw conflict('closed', 'This order no longer needs payment.');
  }
  const check = await reconcileGatewayOrder(env, ctx, o);
  if (check === 'paid') return { status: 'paid' };
  if (check === 'unavailable') throw new HttpError(502, 'gateway_unavailable', 'We couldn’t confirm your online payment just now. Please try again in a moment.');
  const fresh = (await getOrderRow(env.DB, { id: o.id }))!;
  if (isPaid(fresh.payment_status)) return { status: 'paid' };
  await cancelOrder(env, ctx, fresh, 'customer', SWITCHED_METHOD, false, 'customer');
  return { status: 'released' };
}

/**
 * The shopper cancels from their order page (link with the order's secret token) until the order is packed.
 * If it was paid, the refund starts at once.
 */
export async function customerCancel(env: Env, ctx: Ctx, number: string, token: string, reason: string, note: string) {
  const db = env.DB;
  let o = await getOrderRow(db, { number });
  if (!o || !safeEqual(o.access_token, token)) throw notFound('Order not found');
  if (o.status === 'cancelled') throw conflict('already_cancelled', 'This order is already cancelled.');
  // An online payment may have gone through a moment ago: find out first, so it can be refunded.
  if (o.payment_method === 'gateway' && o.payment_status !== 'paid') { await reconcileGatewayOrder(env, ctx, o); o = (await getOrderRow(db, { id: o.id }))!; }
  if (!CUSTOMER_CANCELLABLE.includes(o.status)) {
    throw conflict('too_late', o.status === 'packed' || o.status === 'shipped' ? 'Your order is already packed or on its way, so it can’t be cancelled here. Message us on WhatsApp and we’ll help.' : 'This order can no longer be cancelled.');
  }
  const why = `Cancelled by you: ${reason}${note ? ` (${note})` : ''}`;
  // Only the request that actually cancelled goes on to refund (a double tap must not refund twice).
  if (!(await cancelOrder(env, ctx, o, 'customer', why, true, 'customer'))) throw await cancelConflict(db, o.id);
  const left = o.payment_status === 'paid' ? await refundable(db, o) : 0;
  if (left > 0) await startRefund(env, ctx, o, { amount: left, reason: why, by: 'customer' });
  const fresh = (await getOrderRow(db, { id: o.id }))!;
  ctx.waitUntil((async () => {
    const pub = await toPublicOrder(db, fresh);
    await notifyOrder(env, pub, 'cancelled');
    await sendTelegram(env, `❌ <b>${escHtml(fresh.number)} cancelled by the customer</b> (${escHtml(reason)})${left > 0 ? `. Refund of ${formatINR(left)} started.` : '.'}`);
  })());
  const { email: _e, phone: _p, ...pub } = await toPublicOrder(db, fresh);
  return pub;
}

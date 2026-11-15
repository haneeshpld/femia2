import type { AddressInput, CustomerAddress, CustomerProfile } from '@femia/contracts';
import { all, first, newId, nowIso } from '../lib/db.ts';
import { notFound } from '../lib/http.ts';
import { SWITCHED_METHOD } from './orders.ts';

interface CustomerRow { id: string; email: string; name: string; phone: string; marketing: number; disabled: number; created_at: string; last_login_at: string | null }
interface AddressRow { id: string; label: string; name: string; phone: string; line1: string; line2: string; landmark: string; city: string; state: string; pincode: string; is_default: number }

export const toProfile = (r: CustomerRow): CustomerProfile => ({ id: r.id, email: r.email, name: r.name, phone: r.phone, marketing: r.marketing === 1, createdAt: r.created_at });
const toAddress = (r: AddressRow): CustomerAddress => ({ id: r.id, label: r.label, name: r.name, phone: r.phone, line1: r.line1, line2: r.line2, landmark: r.landmark, city: r.city, state: r.state, pincode: r.pincode, isDefault: r.is_default === 1 });

export const customerByEmail = (db: D1Database, email: string) => first<CustomerRow>(db, 'SELECT * FROM customers WHERE email = ?', email);
export async function getCustomer(db: D1Database, id: string) {
  const r = await first<CustomerRow>(db, 'SELECT * FROM customers WHERE id = ?', id);
  if (!r) throw notFound('Account not found');
  return r;
}

/**
 * Orders placed as a guest with the same (now verified) email become part of the account,
 * along with any offers used on them.
 */
export function claimGuestOrdersStatements(db: D1Database, customerId: string, email: string) {
  return [
    db.prepare('UPDATE orders SET customer_id = ? WHERE customer_id IS NULL AND lower(email) = ?').bind(customerId, email),
    db.prepare('UPDATE order_discounts SET customer_id = ? WHERE customer_id IS NULL AND order_id IN (SELECT id FROM orders WHERE customer_id = ?)').bind(customerId, customerId),
  ];
}

export async function createCustomer(db: D1Database, v: { email: string; name: string; phone: string; marketing: boolean }) {
  const id = newId('cus');
  const now = nowIso();
  await db.batch([
    db.prepare('INSERT INTO customers (id, email, name, phone, email_verified_at, marketing, last_login_at) VALUES (?,?,?,?,?,?,?)').bind(id, v.email, v.name, v.phone, now, v.marketing ? 1 : 0, now),
    ...claimGuestOrdersStatements(db, id, v.email),
    ...(v.marketing ? [db.prepare('INSERT OR IGNORE INTO newsletter_subscribers (email, source) VALUES (?, ?)').bind(v.email, 'account')] : []),
  ]);
  return getCustomer(db, id);
}

export async function listAddresses(db: D1Database, customerId: string) {
  return (await all<AddressRow>(db, 'SELECT * FROM customer_addresses WHERE customer_id = ? ORDER BY is_default DESC, created_at DESC', customerId)).map(toAddress);
}

export async function saveAddress(db: D1Database, customerId: string, a: Required<Omit<AddressInput, 'isDefault'>> & { isDefault: boolean }, id?: string) {
  if (id && !(await first(db, 'SELECT 1 FROM customer_addresses WHERE id = ? AND customer_id = ?', id, customerId))) throw notFound('Address not found');
  const count = (await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM customer_addresses WHERE customer_id = ?', customerId))?.n ?? 0;
  if (!id && count >= 20) throw notFound('You can keep up to 20 addresses');
  const makeDefault = a.isDefault || count === 0 || (!!id && count === 1);
  const addrId = id ?? newId('adr');
  await db.batch([
    ...(makeDefault ? [db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').bind(customerId)] : []),
    id
      ? db.prepare(`UPDATE customer_addresses SET label=?, name=?, phone=?, line1=?, line2=?, landmark=?, city=?, state=?, pincode=?, is_default = CASE WHEN ? THEN 1 ELSE is_default END WHERE id = ? AND customer_id = ?`)
          .bind(a.label, a.name, a.phone, a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, makeDefault ? 1 : 0, addrId, customerId)
      : db.prepare('INSERT INTO customer_addresses (id, customer_id, label, name, phone, line1, line2, landmark, city, state, pincode, is_default) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
          .bind(addrId, customerId, a.label, a.name, a.phone, a.line1, a.line2, a.landmark, a.city, a.state, a.pincode, makeDefault ? 1 : 0),
  ]);
  return listAddresses(db, customerId);
}

export async function deleteAddress(db: D1Database, customerId: string, id: string) {
  const r = await first<{ is_default: number }>(db, 'SELECT is_default FROM customer_addresses WHERE id = ? AND customer_id = ?', id, customerId);
  if (!r) throw notFound('Address not found');
  await db.batch([
    db.prepare('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?').bind(id, customerId),
    // keep one default
    ...(r.is_default ? [db.prepare(`UPDATE customer_addresses SET is_default = 1 WHERE id = (SELECT id FROM customer_addresses WHERE customer_id = ? ORDER BY created_at DESC LIMIT 1)`).bind(customerId)] : []),
  ]);
  return listAddresses(db, customerId);
}

/** Save the checkout address to the account unless the same one is already there. */
export async function rememberAddress(db: D1Database, customerId: string, a: { name: string; phone: string; line1: string; line2: string; landmark: string; city: string; state: string; pincode: string }) {
  const same = await first(db, 'SELECT 1 FROM customer_addresses WHERE customer_id = ? AND lower(line1) = lower(?) AND pincode = ?', customerId, a.line1, a.pincode);
  if (same) return;
  await saveAddress(db, customerId, { label: '', ...a, isDefault: false });
}

const ACTIVE = ['pending_payment', 'new', 'confirmed', 'packed', 'shipped'];

/** Orders and offers for the profile: current ones first, then the history. */
export async function customerOrders(db: D1Database, customerId: string) {
  const orders = await all<{ id: string; number: string; status: string; payment_method: string; payment_status: string; total: number; discount: number; created_at: string; access_token: string; items: number; image: string | null; first_title: string | null; tracking_url: string | null; courier: string | null; refund_state: 'pending' | 'done' | null }>(db,
    `SELECT o.id, o.number, o.status, o.payment_method, o.payment_status, o.total, o.discount, o.created_at, o.access_token, o.tracking_url, o.courier,
            (SELECT COALESCE(SUM(qty),0) FROM order_items WHERE order_id = o.id) AS items,
            (SELECT image_url FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS image,
            (SELECT title FROM order_items WHERE order_id = o.id ORDER BY id LIMIT 1) AS first_title,
            (SELECT CASE WHEN SUM(status IN ('pending','to_send','failed')) > 0 THEN 'pending' WHEN COUNT(*) > 0 THEN 'done' END FROM refunds WHERE order_id = o.id) AS refund_state
     FROM orders o WHERE o.customer_id = ?
       -- set aside at checkout for another payment method, never paid: not an order the shopper placed
       AND NOT (o.status = 'cancelled' AND o.cancel_reason = ? AND o.payment_status NOT IN ('paid','refunded'))
     ORDER BY o.created_at DESC LIMIT 200`, customerId, SWITCHED_METHOD);
  const offers = await all<{ label: string; code: string | null; kind: string; amount: number; number: string; created_at: string }>(db,
    `SELECT d.label, d.code, d.kind, d.amount, o.number, o.created_at FROM order_discounts d JOIN orders o ON o.id = d.order_id
     WHERE o.customer_id = ? AND o.status != 'cancelled' ORDER BY o.created_at DESC`, customerId);
  const list = orders.map((o) => ({
    number: o.number, status: o.status, paymentMethod: o.payment_method, paymentStatus: o.payment_status, total: o.total, discount: o.discount,
    createdAt: o.created_at, items: o.items, image: o.image, title: o.first_title, trackingUrl: o.tracking_url, courier: o.courier,
    url: `/order/${o.number}?token=${encodeURIComponent(o.access_token)}`, current: ACTIVE.includes(o.status), refund: o.refund_state,
  }));
  const spent = orders.filter((o) => !['cancelled', 'pending_payment'].includes(o.status)).reduce((s, o) => s + o.total, 0);
  const saved = offers.reduce((s, d) => s + d.amount, 0);
  return { orders: list, offers: offers.map((d) => ({ label: d.label, code: d.code, kind: d.kind, amount: d.amount, orderNumber: d.number, at: d.created_at })), totals: { orders: list.length, spent, saved } };
}

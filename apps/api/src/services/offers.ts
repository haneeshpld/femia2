import { OfferInput, offerStatus, type Offer } from '@femia/contracts';
import { all, audit, first, newId, nowIso } from '../lib/db.ts';
import { conflict, notFound, parse } from '../lib/http.ts';

interface OfferRow {
  id: string; kind: Offer['kind']; name: string; label: string; style: Offer['style']; code: string | null;
  discount_type: 'percent' | 'amount'; value: number; max_discount: number | null; scope: Offer['scope']; scope_ids: string;
  min_qty: number; min_subtotal: number; first_order_only: number; usage_limit: number | null; per_customer_limit: number | null;
  used_count: number; starts_at: string | null; ends_at: string | null; active: number; created_at: string; updated_at: string;
}

const toOffer = (r: OfferRow): Offer => ({
  id: r.id, kind: r.kind, name: r.name, label: r.label, style: r.style, code: r.code, discountType: r.discount_type, value: r.value,
  maxDiscount: r.max_discount, scope: r.scope, scopeIds: JSON.parse(r.scope_ids) as string[], minQty: r.min_qty, minSubtotal: r.min_subtotal,
  firstOrderOnly: r.first_order_only === 1, usageLimit: r.usage_limit, perCustomerLimit: r.per_customer_limit, usedCount: r.used_count,
  startsAt: r.starts_at, endsAt: r.ends_at, active: r.active === 1,
});

/**
 * Automatic offers (sales, bundles, tags) that could be live now. Cached per isolate for 20s; admin writes clear it.
 * Coupons are never listed here: they're looked up by code.
 */
let cache: { at: number; offers: Offer[] } | null = null;
export function clearOfferCache() { cache = null; }
export async function automaticOffers(db: D1Database): Promise<Offer[]> {
  if (cache && Date.now() - cache.at < 20_000) return cache.offers;
  const rows = await all<OfferRow>(db, "SELECT * FROM offers WHERE active = 1 AND kind IN ('sale','bundle','tag') AND (ends_at IS NULL OR ends_at > ?)", nowIso());
  cache = { at: Date.now(), offers: rows.map(toOffer) };
  return cache.offers;
}

/**
 * Find a coupon and check the rules only the database knows: usage, uses per customer and first order only.
 * A customer is matched by their account, mobile number or email, so signing out or using another number
 * doesn't get round the limits.
 */
export async function checkCoupon(db: D1Database, rawCode: string | null | undefined, who: { phone?: string | null; customerId?: string | null; email?: string | null } = {}): Promise<{ coupon: Offer | null; error: string | null; code: string | null }> {
  const code = rawCode?.trim().toUpperCase() || null;
  if (!code) return { coupon: null, error: null, code: null };
  const row = await first<OfferRow>(db, "SELECT * FROM offers WHERE kind = 'coupon' AND code = ?", code);
  if (!row) return { coupon: null, error: `${code} isn't a valid code`, code };
  const o = toOffer(row);
  const status = offerStatus(o);
  if (status === 'scheduled') return { coupon: null, error: `${code} starts on ${new Date(o.startsAt!).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`, code };
  if (status === 'ended' || status === 'paused') return { coupon: null, error: `${code} has expired`, code };
  if (status === 'used-up') return { coupon: null, error: `${code} has been fully used`, code };
  const digits = who.phone?.replace(/\D/g, '').slice(-10);
  const phone = digits && digits.length === 10 ? digits : null;
  const email = who.email?.trim().toLowerCase() || null;
  const customerId = who.customerId ?? null;
  if (phone || email || customerId) {
    const mine = '(o.phone = ?1 OR lower(o.email) = ?2 OR (?3 IS NOT NULL AND o.customer_id = ?3))';
    if (o.firstOrderOnly) {
      const prior = await first<{ n: number }>(db, `SELECT COUNT(*) AS n FROM orders o WHERE ${mine} AND o.status != 'cancelled'`, phone ?? '-', email ?? '-', customerId);
      if ((prior?.n ?? 0) > 0) return { coupon: null, error: `${code} is for first orders only`, code };
    }
    if (o.perCustomerLimit) {
      const used = await first<{ n: number }>(db,
        `SELECT COUNT(*) AS n FROM order_discounts d JOIN orders o ON o.id = d.order_id WHERE d.offer_id = ?4 AND ${mine} AND o.status != 'cancelled'`, phone ?? '-', email ?? '-', customerId, o.id);
      if ((used?.n ?? 0) >= o.perCustomerLimit) return { coupon: null, error: `You've already used ${code}`, code };
    }
  }
  return { coupon: o, error: null, code };
}

// ───────────── admin ─────────────

export async function listOffers(db: D1Database) {
  const rows = await all<OfferRow & { orders: number; given: number }>(db, `
    SELECT o.*, (SELECT COUNT(*) FROM order_discounts d JOIN orders x ON x.id = d.order_id WHERE d.offer_id = o.id AND x.status != 'cancelled') AS orders,
           (SELECT COALESCE(SUM(d.amount), 0) FROM order_discounts d JOIN orders x ON x.id = d.order_id WHERE d.offer_id = o.id AND x.status != 'cancelled') AS given
    FROM offers o ORDER BY o.active DESC, COALESCE(o.ends_at, '9999') ASC, o.created_at DESC`);
  return rows.map((r) => ({ ...toOffer(r), status: offerStatus(toOffer(r)), orders: r.orders, discountGiven: r.given, createdAt: r.created_at }));
}

export async function saveOffer(db: D1Database, input: unknown, actor: string, id?: string) {
  const o = parse(OfferInput, input);
  if (id && !(await first(db, 'SELECT 1 FROM offers WHERE id = ?', id))) throw notFound('Offer not found');
  if (o.code) {
    const dup = await first<{ id: string }>(db, 'SELECT id FROM offers WHERE code = ? AND id != ?', o.code, id ?? '');
    if (dup) throw conflict('code_taken', `The code ${o.code} is already used by another coupon`);
  }
  const offerId = id ?? newId('off');
  const cols = [o.kind, o.name, o.label, o.style, o.code, o.discountType, o.value, o.maxDiscount, o.scope, JSON.stringify(o.scopeIds), o.minQty, o.minSubtotal,
    o.firstOrderOnly ? 1 : 0, o.usageLimit, o.perCustomerLimit, o.startsAt, o.endsAt, o.active ? 1 : 0];
  await db.batch([
    id
      ? db.prepare(`UPDATE offers SET kind=?, name=?, label=?, style=?, code=?, discount_type=?, value=?, max_discount=?, scope=?, scope_ids=?, min_qty=?, min_subtotal=?,
          first_order_only=?, usage_limit=?, per_customer_limit=?, starts_at=?, ends_at=?, active=?, updated_at=? WHERE id=?`).bind(...cols, nowIso(), offerId)
      : db.prepare(`INSERT INTO offers (kind, name, label, style, code, discount_type, value, max_discount, scope, scope_ids, min_qty, min_subtotal,
          first_order_only, usage_limit, per_customer_limit, starts_at, ends_at, active, id, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(...cols, offerId, actor),
    audit(db, actor, id ? 'offer.update' : 'offer.create', 'offer', offerId, `${o.kind}: ${o.name}`),
  ]);
  clearOfferCache();
  return (await listOffers(db)).find((x) => x.id === offerId)!;
}

export async function setOfferActive(db: D1Database, id: string, active: boolean, actor: string) {
  const r = await db.prepare('UPDATE offers SET active = ?, updated_at = ? WHERE id = ?').bind(active ? 1 : 0, nowIso(), id).run();
  if (!r.meta.changes) throw notFound('Offer not found');
  await audit(db, actor, active ? 'offer.resume' : 'offer.pause', 'offer', id, active ? 'Resumed' : 'Paused').run();
  clearOfferCache();
}

/** Offers that were used on orders are kept for the records (end them instead); unused ones can be deleted. */
export async function deleteOffer(db: D1Database, id: string, actor: string) {
  const used = await first<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM order_discounts WHERE offer_id = ?', id);
  if ((used?.n ?? 0) > 0) throw conflict('offer_used', 'This offer is on past orders, so it can’t be deleted. Pause it instead.');
  await db.batch([db.prepare('DELETE FROM offers WHERE id = ?').bind(id), audit(db, actor, 'offer.delete', 'offer', id, 'Deleted')]);
  clearOfferCache();
}

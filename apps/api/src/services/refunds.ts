import { formatINR } from '@femia/contracts';
import type { Env } from '../env.ts';
import { all, audit, first, newId, nowIso } from '../lib/db.ts';
import { conflict, HttpError, notFound } from '../lib/http.ts';
import { escHtml, sendTelegram } from '../notify/index.ts';
import { getGatewayKeys, getProvider } from '../payments/index.ts';

type Ctx = { waitUntil(p: Promise<unknown>): void };
export interface RefundRow {
  id: string; order_id: string; provider: string | null; provider_payment_id: string | null; provider_refund_id: string | null; amount: number;
  status: 'pending' | 'processed' | 'failed' | 'to_send' | 'sent'; reason: string; reference: string | null; error: string | null;
  requested_by: string; created_at: string; updated_at: string; processed_at: string | null;
}
type OrderLike = { id: string; number: string; total: number; payment_method: string; payment_status: string; customer_name: string; phone: string };

export const listRefunds = (db: D1Database, orderId: string) => all<RefundRow>(db, 'SELECT * FROM refunds WHERE order_id = ? ORDER BY created_at', orderId);

/** Money that can still be given back: what was paid, less refunds that are done or under way. */
export async function refundable(db: D1Database, o: OrderLike) {
  if (o.payment_status !== 'paid') return 0;
  const r = await first<{ n: number }>(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM refunds WHERE order_id = ? AND status != 'failed'", o.id);
  return Math.max(0, o.total - (r?.n ?? 0));
}

const event = (db: D1Database, orderId: string, note: string, actor: string, isPublic = true) =>
  db.prepare('INSERT INTO order_events (order_id, status, note, actor, public) VALUES (?, ?, ?, ?, ?)').bind(orderId, 'refund', note, actor, isPublic ? 1 : 0);

/** When every rupee is back with the shopper, the order shows as refunded. */
async function settle(db: D1Database, orderId: string) {
  const o = await first<{ total: number; payment_status: string }>(db, 'SELECT total, payment_status FROM orders WHERE id = ?', orderId);
  const done = await first<{ n: number }>(db, "SELECT COALESCE(SUM(amount), 0) AS n FROM refunds WHERE order_id = ? AND status IN ('processed','sent')", orderId);
  if (o && o.payment_status === 'paid' && (done?.n ?? 0) >= o.total) {
    await db.prepare("UPDATE orders SET payment_status = 'refunded', updated_at = ? WHERE id = ?").bind(nowIso(), orderId).run();
  }
}

/**
 * Give money back. Online payments go straight back to the card / UPI / bank through the gateway; UPI paid to the
 * shop and cash are recorded as "to send" for the owner, who marks them sent with the UPI reference.
 */
/**
 * Insert a refund row only if the order still has at least `amount` left to refund, in one statement. Two refund
 * requests at once (a double tap, a cancel racing a refund) can't both pass: the second sees the first's row.
 */
function reserveRefund(db: D1Database, r: { id: string; orderId: string; provider: string | null; paymentId: string | null; amount: number; status: 'pending' | 'to_send'; reason: string; by: string; at: string }) {
  return db.prepare(`INSERT INTO refunds (id, order_id, provider, provider_payment_id, amount, status, reason, requested_by, created_at, updated_at)
    SELECT ?,?,?,?,?,?,?,?,?,?
    WHERE (SELECT total FROM orders WHERE id = ? AND payment_status = 'paid')
          - (SELECT COALESCE(SUM(amount), 0) FROM refunds WHERE order_id = ? AND status != 'failed') >= ?`)
    .bind(r.id, r.orderId, r.provider, r.paymentId, r.amount, r.status, r.reason, r.by, r.at, r.at, r.orderId, r.orderId, r.amount);
}

export async function startRefund(env: Env, ctx: Ctx, o: OrderLike, v: { amount: number; reason: string; by: string }): Promise<RefundRow> {
  const db = env.DB;
  const tooMuch = async () => {
    const fresh = await first<OrderLike>(db, 'SELECT * FROM orders WHERE id = ?', o.id);
    const left = fresh ? await refundable(db, fresh) : 0;
    if (left <= 0) return conflict('nothing_to_refund', fresh?.payment_status === 'refunded' ? 'This order is already fully refunded.' : 'There is no payment to refund on this order.');
    return new HttpError(422, 'validation', `You can refund up to ${formatINR(left)}`, { fields: { amount: `Up to ${formatINR(left)}` } });
  };
  if (v.amount <= 0 || v.amount > (await refundable(db, o))) throw await tooMuch();

  const id = newId('rfd');
  const pay = o.payment_method === 'gateway'
    ? await first<{ provider: string; provider_payment_id: string | null }>(db, "SELECT provider, provider_payment_id FROM payments WHERE order_id = ? AND status = 'paid' ORDER BY updated_at DESC LIMIT 1", o.id)
    : null;
  const now = nowIso();

  if (pay?.provider_payment_id) {
    // Hold the amount first, then ask the gateway, so a second request can't refund the same money.
    const held = await reserveRefund(db, { id, orderId: o.id, provider: pay.provider, paymentId: pay.provider_payment_id, amount: v.amount, status: 'pending', reason: v.reason, by: v.by, at: now }).run();
    if (!held.meta.changes) throw await tooMuch();
    let status: RefundRow['status'] = 'failed';
    let providerRefundId: string | null = null;
    let error: string | null = null;
    try {
      const keys = await getGatewayKeys(env, pay.provider);
      if (!keys) throw new Error('Payment gateway keys are missing');
      const r = await getProvider(pay.provider).refund(pay.provider_payment_id, v.amount, keys, { order_number: o.number, refund_id: id, reason: v.reason.slice(0, 200) });
      status = r.status; providerRefundId = r.providerRefundId;
    } catch (e) { error = (e as Error).message.slice(0, 300); }
    const at = nowIso();
    await db.batch([
      db.prepare('UPDATE refunds SET status = ?, provider_refund_id = ?, error = ?, updated_at = ?, processed_at = ? WHERE id = ?')
        .bind(status, providerRefundId, error, at, status === 'processed' ? at : null, id),
      event(db, o.id, status === 'failed' ? `Refund of ${formatINR(v.amount)} couldn't start; we're on it` : `Refund of ${formatINR(v.amount)} started to your original payment method`, v.by, status !== 'failed'),
      audit(db, v.by, status === 'failed' ? 'refund.failed' : 'refund.start', 'order', o.id, `${o.number}: ${formatINR(v.amount)} via ${pay.provider}${error ? ` (${error})` : ''}`),
    ]);
    if (status === 'failed') ctx.waitUntil(sendTelegram(env, `⚠️ <b>Refund failed</b> for ${escHtml(o.number)} (${formatINR(v.amount)}): ${escHtml(error ?? '')}. Retry it in Admin → order.`));
    if (status === 'processed') await settle(db, o.id);
  } else {
    const res = await db.batch([
      reserveRefund(db, { id, orderId: o.id, provider: null, paymentId: null, amount: v.amount, status: 'to_send', reason: v.reason, by: v.by, at: now }),
      db.prepare('INSERT INTO order_events (order_id, status, note, actor, public) SELECT ?, ?, ?, ?, 1 WHERE EXISTS (SELECT 1 FROM refunds WHERE id = ?)')
        .bind(o.id, 'refund', `Refund of ${formatINR(v.amount)} is being arranged; we'll send it to you by UPI`, v.by, id),
      db.prepare("INSERT INTO audit_log (actor, action, entity, entity_id, summary) SELECT ?, 'refund.manual', 'order', ?, ? WHERE EXISTS (SELECT 1 FROM refunds WHERE id = ?)")
        .bind(v.by, o.id, `${o.number}: ${formatINR(v.amount)} to send by UPI`, id),
    ]);
    if (!res[0]!.meta.changes) throw await tooMuch();
    ctx.waitUntil(sendTelegram(env, `💸 <b>Refund to send</b>: ${formatINR(v.amount)} to ${escHtml(o.customer_name)} (${escHtml(o.phone)}) for ${escHtml(o.number)}. Send it by UPI, then tap "Mark sent" in Admin.`));
  }
  return (await first<RefundRow>(db, 'SELECT * FROM refunds WHERE id = ?', id))!;
}

/** Update one gateway refund from the gateway (also used by webhooks with the status they carry). */
export async function applyRefundStatus(env: Env, r: RefundRow, status: 'pending' | 'processed' | 'failed', actor = 'gateway') {
  if (r.status === status || r.status === 'processed') return r;
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE refunds SET status = ?, updated_at = ?, processed_at = CASE WHEN ? = \'processed\' THEN ? ELSE processed_at END WHERE id = ?').bind(status, now, status, now, r.id),
    ...(status === 'processed' ? [event(env.DB, r.order_id, `Refund of ${formatINR(r.amount)} completed`, actor)] : []),
    ...(status === 'failed' ? [event(env.DB, r.order_id, `Refund of ${formatINR(r.amount)} failed at the bank`, actor, false)] : []),
  ]);
  if (status === 'processed') await settle(env.DB, r.order_id);
  if (status === 'failed') await sendTelegram(env, `⚠️ A refund of ${formatINR(r.amount)} failed at the bank. Retry it in Admin.`).catch(() => {});
  return (await first<RefundRow>(env.DB, 'SELECT * FROM refunds WHERE id = ?', r.id))!;
}

export async function syncRefund(env: Env, r: RefundRow) {
  if (!r.provider || !r.provider_refund_id || r.status !== 'pending') return r;
  const keys = await getGatewayKeys(env, r.provider);
  if (!keys) return r;
  return applyRefundStatus(env, r, await getProvider(r.provider).refundStatus(r.provider_refund_id, keys));
}

/** Every few minutes: follow gateway refunds that are still on their way. */
export async function syncPendingRefunds(env: Env) {
  const rows = await all<RefundRow>(env.DB, "SELECT * FROM refunds WHERE status = 'pending' AND provider_refund_id IS NOT NULL AND updated_at < ? ORDER BY updated_at LIMIT 15",
    new Date(Date.now() - 2 * 60e3).toISOString());
  for (const r of rows) await syncRefund(env, r).catch((e) => console.error('refund sync', r.id, e));

  // A refund whose amount was held but whose gateway answer was never recorded (the request was cut off mid-way).
  // Don't guess: mark it failed so the owner sees it, checks the Razorpay dashboard, and only then retries.
  const stuck = await all<RefundRow & { number: string }>(env.DB, `SELECT r.*, o.number FROM refunds r JOIN orders o ON o.id = r.order_id
    WHERE r.status = 'pending' AND r.provider IS NOT NULL AND r.provider_refund_id IS NULL AND r.updated_at < ? LIMIT 15`, new Date(Date.now() - 10 * 60e3).toISOString());
  for (const r of stuck) {
    const done = await env.DB.prepare("UPDATE refunds SET status = 'failed', error = ?, updated_at = ? WHERE id = ? AND status = 'pending' AND provider_refund_id IS NULL")
      .bind('No answer from the gateway. Check the Razorpay dashboard for this refund before retrying.', nowIso(), r.id).run();
    if (done.meta.changes) await sendTelegram(env, `⚠️ <b>Refund unclear</b> for ${escHtml(r.number)} (${formatINR(r.amount)}): check Razorpay → Refunds before retrying in Admin.`).catch(() => {});
  }
}

/** A failed gateway refund, tried again. The failed row is removed only once the new attempt is recorded. */
export async function retryRefund(env: Env, ctx: Ctx, refundId: string, by: string) {
  const r = await first<RefundRow>(env.DB, 'SELECT * FROM refunds WHERE id = ?', refundId);
  if (!r) throw notFound('Refund not found');
  if (r.status !== 'failed') throw conflict('not_failed', 'Only failed refunds can be retried');
  const o = await first<OrderLike>(env.DB, 'SELECT * FROM orders WHERE id = ?', r.order_id);
  const next = await startRefund(env, ctx, o!, { amount: r.amount, reason: r.reason, by }); // failed rows don't count, so the amount is free
  await env.DB.prepare("DELETE FROM refunds WHERE id = ? AND status = 'failed'").bind(r.id).run(); // the new attempt replaces it
  return next;
}

export async function markRefundSent(env: Env, refundId: string, reference: string, by: string) {
  const r = await first<RefundRow>(env.DB, 'SELECT * FROM refunds WHERE id = ?', refundId);
  if (!r) throw notFound('Refund not found');
  if (r.status !== 'to_send') throw conflict('not_manual', 'Only refunds waiting to be sent can be marked sent');
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare("UPDATE refunds SET status = 'sent', reference = ?, updated_at = ?, processed_at = ? WHERE id = ?").bind(reference, now, now, r.id),
    event(env.DB, r.order_id, `Refund of ${formatINR(r.amount)} sent by UPI (ref ${reference})`, by),
    audit(env.DB, by, 'refund.sent', 'order', r.order_id, `${formatINR(r.amount)} sent, ref ${reference}`),
  ]);
  await settle(env.DB, r.order_id);
}

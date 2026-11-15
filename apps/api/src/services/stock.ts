import type { StockAdjustInput, StockReason } from '@femia/contracts';
import { StockAdjustInput as AdjustSchema } from '@femia/contracts';
import { all, audit, first, isConstraintError } from '../lib/db.ts';
import { conflict, notFound, parse } from '../lib/http.ts';

export interface StockLine { variantId: string; qty: number }

/**
 * Every statement below relies on variants' CHECK constraints (on_hand >= 0, reserved <= on_hand).
 * Run them inside a single db.batch(): if any line would oversell, the batch throws and nothing is written.
 */
const ledger = (db: D1Database, l: StockLine, delta: number, reservedDelta: number, reason: StockReason, orderId: string | null, actor: string, note = '') =>
  db.prepare('INSERT INTO stock_ledger (variant_id, delta, reserved_delta, reason, order_id, actor, note) VALUES (?,?,?,?,?,?,?)')
    .bind(l.variantId, delta, reservedDelta, reason, orderId, actor, note);

export function holdStatements(db: D1Database, orderId: string, lines: StockLine[], actor: string) {
  return lines.flatMap((l) => [
    db.prepare('UPDATE variants SET reserved = reserved + ? WHERE id = ?').bind(l.qty, l.variantId),
    ledger(db, l, 0, l.qty, 'hold', orderId, actor),
  ]);
}

/** Sell straight from stock (COD, manual orders). */
export function commitDirectStatements(db: D1Database, orderId: string, lines: StockLine[], actor: string) {
  return lines.flatMap((l) => [
    db.prepare('UPDATE variants SET on_hand = on_hand - ? WHERE id = ?').bind(l.qty, l.variantId),
    ledger(db, l, -l.qty, 0, 'sale', orderId, actor),
  ]);
}

/**
 * Held-stock statements are guarded by the order still being 'held', so a payment confirmation and the
 * hold-release cron can never both apply (D1 runs each batch atomically and serially).
 */
const HELD = "EXISTS (SELECT 1 FROM orders WHERE id = ? AND stock_state = 'held')";
const guardedLedger = (db: D1Database, l: StockLine, delta: number, reservedDelta: number, reason: StockReason, orderId: string, actor: string, note = '') =>
  db.prepare(`INSERT INTO stock_ledger (variant_id, delta, reserved_delta, reason, order_id, actor, note) SELECT ?,?,?,?,?,?,? WHERE ${HELD}`)
    .bind(l.variantId, delta, reservedDelta, reason, orderId, actor, note, orderId);

/** Turn a hold into a sale (payment confirmed). Must precede the orders UPDATE in the same batch. */
export function commitHeldStatements(db: D1Database, orderId: string, lines: StockLine[], actor: string) {
  return lines.flatMap((l) => [
    guardedLedger(db, l, -l.qty, -l.qty, 'sale', orderId, actor),
    db.prepare(`UPDATE variants SET on_hand = on_hand - ?, reserved = reserved - ? WHERE id = ? AND ${HELD}`).bind(l.qty, l.qty, l.variantId, orderId),
  ]);
}

/** Give held units back. Must precede the orders UPDATE in the same batch. */
export function releaseHeldStatements(db: D1Database, orderId: string, lines: StockLine[], actor: string, note = '') {
  return lines.flatMap((l) => [
    guardedLedger(db, l, 0, -l.qty, 'release', orderId, actor, note),
    db.prepare(`UPDATE variants SET reserved = reserved - ? WHERE id = ? AND ${HELD}`).bind(l.qty, l.variantId, orderId),
  ]);
}

/**
 * Put sold units back (cancelled after stock was committed). Guarded by the order still being committed and not
 * cancelled, so two cancels at once (a double tap, staff and shopper together) give the units back only once.
 * Must precede the orders UPDATE in the same batch.
 */
const COMMITTED = "EXISTS (SELECT 1 FROM orders WHERE id = ? AND stock_state = 'committed' AND status != 'cancelled')";
export function restockStatements(db: D1Database, orderId: string, lines: StockLine[], actor: string, note = '') {
  return lines.flatMap((l) => [
    db.prepare(`INSERT INTO stock_ledger (variant_id, delta, reserved_delta, reason, order_id, actor, note) SELECT ?,?,?,?,?,?,? WHERE ${COMMITTED}`)
      .bind(l.variantId, l.qty, 0, 'cancel', orderId, actor, note, orderId),
    db.prepare(`UPDATE variants SET on_hand = on_hand + ? WHERE id = ? AND ${COMMITTED}`).bind(l.qty, l.variantId, orderId),
  ]);
}

/**
 * Sell again the units of an order whose hold was released (paid late). Guarded by the order still being released
 * and unpaid, so the browser return and both Razorpay webhooks arriving together take the stock only once.
 * Must precede the orders UPDATE in the same batch.
 */
const RELEASED_UNPAID = "EXISTS (SELECT 1 FROM orders WHERE id = ? AND stock_state = 'released' AND payment_status NOT IN ('paid','refunded'))";
export function resellReleasedStatements(db: D1Database, orderId: string, lines: StockLine[], actor: string) {
  return lines.flatMap((l) => [
    db.prepare(`INSERT INTO stock_ledger (variant_id, delta, reserved_delta, reason, order_id, actor, note) SELECT ?,?,?,?,?,?,? WHERE ${RELEASED_UNPAID}`)
      .bind(l.variantId, -l.qty, 0, 'sale', orderId, actor, '', orderId),
    db.prepare(`UPDATE variants SET on_hand = on_hand - ? WHERE id = ? AND ${RELEASED_UNPAID}`).bind(l.qty, l.variantId, orderId),
  ]);
}

export async function adjustStock(db: D1Database, input: StockAdjustInput, actor: string) {
  const a = parse(AdjustSchema, input);
  const v = await first<{ id: string; sku: string }>(db, 'SELECT id, sku FROM variants WHERE id = ?', a.variantId);
  if (!v) throw notFound('Variant not found');
  try {
    await db.batch([
      db.prepare('UPDATE variants SET on_hand = on_hand + ? WHERE id = ?').bind(a.delta, a.variantId),
      ledger(db, { variantId: a.variantId, qty: 0 }, a.delta, 0, a.reason, null, actor, a.note),
      audit(db, actor, 'stock.adjust', 'variant', a.variantId, `${a.delta > 0 ? '+' : ''}${a.delta} ${v.sku} (${a.reason})`),
    ]);
  } catch (e) {
    if (isConstraintError(e)) throw conflict('insufficient_stock', "You can't remove more than what's in stock (units waiting for payment are held).");
    throw e;
  }
  return first<{ on_hand: number; reserved: number }>(db, 'SELECT on_hand, reserved FROM variants WHERE id = ?', a.variantId);
}

export function stockHistory(db: D1Database, variantId: string, limit = 50) {
  return all<{ id: number; delta: number; reserved_delta: number; reason: string; order_id: string | null; note: string; actor: string; created_at: string }>(
    db, 'SELECT id, delta, reserved_delta, reason, order_id, note, actor, created_at FROM stock_ledger WHERE variant_id = ? ORDER BY id DESC LIMIT ?', variantId, limit);
}

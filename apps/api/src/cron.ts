import { formatINR } from '@femia/contracts';
import type { Env } from './env.ts';
import { syncPendingRefunds } from './services/refunds.ts';
import { all, first } from './lib/db.ts';
import { escHtml, sendTelegram } from './notify/index.ts';
import { reconcilePendingGateway, releaseExpiredHolds } from './services/orders.ts';
import { lowStock } from './services/products.ts';
import { getSettings } from './services/settings.ts';

// Everything needed to run the shop again. Left out on purpose: sessions, sign-in codes, rate-limit counters and
// pending admin sign-ups (short-lived; everyone simply signs in again) and analytics events (large, not needed).
const BACKUP_TABLES = [
  'media', 'categories', 'collections', 'products', 'product_options', 'variants', 'product_media', 'product_collections',
  'offers', 'customers', 'customer_addresses',
  'stock_ledger', 'orders', 'order_items', 'order_events', 'order_discounts', 'payments', 'refunds', 'webhook_events',
  'content_versions', 'settings', 'secrets', 'roles', 'users', 'audit_log', 'newsletter_subscribers', 'counters',
] as const;

/** Nightly logical backup of every table to R2 as gzipped JSON. tools/restore-backup.mjs turns it back into SQL. */
export async function backupToR2(env: Env) {
  const dump: Record<string, unknown[]> = {};
  for (const t of BACKUP_TABLES) dump[t] = await all(env.DB, `SELECT * FROM ${t}`);
  const json = JSON.stringify({ version: 1, createdAt: new Date().toISOString(), tables: dump });
  const gz = new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip')));
  const key = `backups/${new Date().toISOString().slice(0, 10)}.json.gz`;
  await env.MEDIA.put(key, await gz.arrayBuffer(), { httpMetadata: { contentType: 'application/gzip' } });
  return key;
}

export async function dailySummary(env: Env) {
  const s = await getSettings(env.DB);
  const since = new Date(Date.now() - 864e5).toISOString();
  const [sales, waiting, upi, low] = await Promise.all([
    first<{ n: number; total: number }>(env.DB, "SELECT COUNT(*) AS n, COALESCE(SUM(total),0) AS total FROM orders WHERE status NOT IN ('cancelled','pending_payment') AND created_at >= ?", since),
    first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM orders WHERE status IN ('new','confirmed','packed')"),
    first<{ n: number }>(env.DB, "SELECT COUNT(*) AS n FROM orders WHERE status = 'pending_payment' AND payment_method = 'upi'"),
    lowStock(env.DB, s.notifications.lowStockThreshold, 8),
  ]);
  const lowLines = low.map((l) => `• ${escHtml(l.title)} ${escHtml([l.option1, l.option2].filter(Boolean).join('/'))}: ${l.available} left`).join('\n');
  if (s.notifications.dailySummary) {
    await sendTelegram(env, [
      '☀️ <b>Good morning! Yesterday at Femia</b>',
      `Orders: <b>${sales?.n ?? 0}</b> · Sales: <b>${formatINR(sales?.total ?? 0)}</b>`,
      `Waiting to ship: ${waiting?.n ?? 0}${upi?.n ? ` · UPI to verify: ${upi.n}` : ''}`,
      low.length ? `\n<b>Low stock</b>\n${lowLines}` : 'Stock levels look healthy.',
      `\n${env.ADMIN_URL}`,
    ].join('\n'));
  }
}

export async function scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
  switch (controller.cron) {
    case '*/5 * * * *': {
      // Each job runs on its own: a payment check that fails must never keep refunds from being followed or
      // expired holds from being released (stock stuck "held" makes the shop look sold out).
      const paid = await step('payment check', () => reconcilePendingGateway(env, ctx));
      if (paid) console.log(`confirmed ${paid} online payments with the gateway`);
      await step('refund sync', () => syncPendingRefunds(env));
      const n = await step('hold release', () => releaseExpiredHolds(env, ctx));
      if (n) console.log(`released ${n} expired holds`);
      break;
    }
    case '30 3 * * *': await dailySummary(env); break;
    case '30 21 * * *': {
      const key = await step('backup', () => backupToR2(env));
      if (key) console.log('backup', key);
      // Nobody reads logs: a shop without last night's backup should hear about it.
      else await sendTelegram(env, '⚠️ <b>Last night’s backup did not complete.</b> The shop keeps working; please tell whoever looks after the website.').catch(() => {});
      await step('cleanup', () => cleanupAuth(env));
      break;
    }
  }
}

async function step<T>(name: string, fn: () => Promise<T>): Promise<T | undefined> {
  try { return await fn(); } catch (e) { console.error(`cron: ${name} failed`, e); return undefined; }
}

/** Nightly: forget expired codes, ended sessions, stale sign-ups and old rate-limit windows. */
async function cleanupAuth(env: Env) {
  const day = new Date(Date.now() - 864e5).toISOString();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM otp_codes WHERE created_at < ?').bind(day),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)').bind(day, day),
    env.DB.prepare('DELETE FROM admin_signups WHERE created_at < ?').bind(day),
    env.DB.prepare('DELETE FROM rate_limits WHERE reset_at < ?').bind(Math.floor(Date.now() / 1000)),
  ]);
}

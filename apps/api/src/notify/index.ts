import { formatINR, type PublicOrder } from '@femia/contracts';
import type { Env } from '../env.ts';
import { getSettings } from '../services/settings.ts';
import { orderEmail, type OrderEmailKind } from './templates.ts';

export interface EmailMessage { to: string; subject: string; html: string; text: string }

/** EmailProvider: Resend in 1.0. Without an API key (local dev) messages are logged instead of sent. */
export async function sendEmail(env: Env, msg: EmailMessage) {
  if (!env.RESEND_API_KEY) { console.log(`[email:dev] to=${msg.to} subject="${msg.subject}"`); return; }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM, to: [msg.to], subject: msg.subject, html: msg.html, text: msg.text }),
  });
  if (!res.ok) console.error('email failed', res.status, await res.text());
}

export async function sendTelegram(env: Env, text: string) {
  const s = await getSettings(env.DB);
  const chat = s.notifications.telegramChatId;
  if (!env.TELEGRAM_BOT_TOKEN || !chat) { console.log(`[telegram:dev] ${text.replace(/\n/g, ' | ')}`); return; }
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error('telegram failed', res.status, await res.text());
}

/** Escape text for Telegram's HTML mode and for emails. Anything a shopper or sign-up typed must go through this:
 * a stray `<` makes Telegram reject the whole message (the owner would never hear about the order). */
export const escHtml = (s: string) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const esc = escHtml;
const METHOD: Record<string, string> = { upi: 'UPI', gateway: 'Online', cod: 'COD', whatsapp: 'WhatsApp' };

export async function notifyOrder(env: Env, order: PublicOrder & { email: string; phone: string }, kind: OrderEmailKind | 'owner_new' | 'owner_failed') {
  const s = await getSettings(env.DB);
  if (kind === 'owner_new' || kind === 'owner_failed') {
    const head = kind === 'owner_failed' ? '⚠️ <b>Payment failed</b>'
      : order.paymentMethod === 'upi' && order.paymentStatus !== 'paid' ? '🕐 <b>New UPI order: check your UPI app, then tap "Mark UPI paid"</b>'
      : order.paymentMethod === 'whatsapp' ? '💬 <b>New WhatsApp order: confirm with the customer</b>'
      : '🛍 <b>New order</b>';
    const items = order.items.map((i) => `• ${esc(i.title)} (${esc(i.optionLabel)}) × ${i.qty}`).join('\n');
    await sendTelegram(env, `${head} ${esc(order.number)}\n${esc(order.customerName)} · ${esc(order.city)}\n${items}\n<b>${formatINR(order.total)}</b> · ${METHOD[order.paymentMethod]}\n${env.ADMIN_URL}/orders/${order.number}`);
    return;
  }
  if (!order.email) return;
  await sendEmail(env, { to: order.email, ...orderEmail(kind, order, { storeName: s.store.name, siteUrl: env.PUBLIC_SITE_URL, whatsapp: s.store.whatsapp }) });
}

/** After a sale: alert the owner about variants that just reached their low-stock level. */
export async function notifyLowStock(env: Env, variantIds: string[]) {
  if (!variantIds.length) return;
  const s = await getSettings(env.DB);
  const rows = await env.DB.prepare(
    `SELECT p.title, v.option1, v.option2, MAX(v.on_hand - v.reserved, 0) AS available FROM variants v JOIN products p ON p.id = v.product_id
     WHERE v.id IN (${variantIds.map(() => '?').join(',')}) AND (v.on_hand - v.reserved) <= COALESCE(v.low_stock_threshold, ?)`,
  ).bind(...variantIds, s.notifications.lowStockThreshold).all<{ title: string; option1: string | null; option2: string | null; available: number }>();
  if (!rows.results.length) return;
  const lines = rows.results.map((r) => `• ${esc(r.title)} ${esc([r.option1, r.option2].filter(Boolean).join('/'))}: ${r.available === 0 ? '<b>sold out</b>' : `${r.available} left`}`).join('\n');
  await sendTelegram(env, `📦 <b>Low stock</b>\n${lines}\n${env.ADMIN_URL}/stock?filter=low`);
}

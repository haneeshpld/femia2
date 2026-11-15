import { createExecutionContext, env, waitOnExecutionContext } from 'cloudflare:test';
import { app } from '../src/index.ts';
import type { Env } from '../src/env.ts';

export const E = env as unknown as Env;
let seq = 0;
const uid = () => `${Date.now().toString(36)}${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export async function call(method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const ctx = createExecutionContext();
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  }, E, ctx);
  await waitOnExecutionContext(ctx);
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { status: res.status, json, text, setCookie: res.headers.get('set-cookie') };
}

export async function seedBasics() {
  const s = (k: string, v: unknown) => E.DB.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').bind(k, JSON.stringify(v));
  await E.DB.batch([
    E.DB.prepare("INSERT OR IGNORE INTO categories (id, slug, name) VALUES ('cat_t', 'kurtas', 'Kurtas')"),
    E.DB.prepare("INSERT OR IGNORE INTO users (id, email, name, role_id) VALUES ('usr_staff', 'staff@test.local', 'Staff', 'staff')"),
    s('store', { name: 'Femia', whatsapp: '9847000000' }),
    s('payments', { upi: { enabled: true, vpa: 'femia@upi', holdHours: 12 }, gateway: { enabled: true, provider: 'razorpay' }, whatsapp: { enabled: true } }),
  ]);
}

/** A fresh product with one variant per entry in `stock`; returns variant ids. */
export async function seedProduct(stock: number[], price = 129900) {
  const pid = `prd_${uid()}`;
  const ids = stock.map((_, i) => `var_${uid()}${i}`);
  await E.DB.batch([
    E.DB.prepare("INSERT INTO products (id, slug, title, category_id, status, price, published_at) VALUES (?, ?, 'Test Kurta', 'cat_t', 'active', ?, ?)").bind(pid, pid.replace('_', '-'), price, new Date().toISOString()),
    ...stock.map((n, i) => E.DB.prepare("INSERT INTO variants (id, product_id, sku, option1, option2, on_hand) VALUES (?, ?, ?, ?, 'maroon', ?)").bind(ids[i], pid, `SKU-${ids[i]}`, `S${i}`, n)),
  ]);
  return { productId: pid, slug: pid.replace('_', '-'), variantIds: ids };
}

export const checkout = (variantId: string, paymentMethod: string, extra: Record<string, unknown> = {}) => ({
  lines: [{ variantId, qty: 1 }],
  customer: { name: 'Anu Thomas', phone: '9847012345', email: 'anu@example.com' },
  address: { line1: '12 Rose Villa', city: 'Kochi', pincode: '682036' },
  paymentMethod, clientRef: `ref-${uid()}`, ...extra,
});

export async function variant(id: string) {
  return (await E.DB.prepare('SELECT on_hand, reserved FROM variants WHERE id = ?').bind(id).first<{ on_hand: number; reserved: number }>())!;
}

export async function expireHolds() {
  await E.DB.prepare("UPDATE orders SET hold_expires_at = '2000-01-01T00:00:00.000Z' WHERE stock_state = 'held'").run();
}

/** Turn a Set-Cookie header into a Cookie header for the next request. */
export const cookieFrom = (setCookie: string | null) => (setCookie ?? '').split(/,(?=\s*[^;=]+=)/).map((c) => c.split(';')[0]!.trim()).filter((c) => !c.endsWith('=')).join('; ');

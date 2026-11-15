import { createMiddleware } from 'hono/factory';
import type { Permission } from '@femia/contracts';
import type { AdminUser, AppEnv } from '../env.ts';
import { forbidden, HttpError } from './http.ts';
import { first } from './db.ts';
import { assertSameOrigin } from './security.ts';
import { currentSession } from '../services/sessions.ts';

type UserRow = { id: string; email: string; name: string; role_id: string; permissions: string; status: string };
const USER_SQL = 'SELECT u.id, u.email, u.name, u.role_id, r.permissions, u.status FROM users u JOIN roles r ON r.id = u.role_id WHERE ';

/**
 * Admin requests need a live admin session (password + emailed code, see routes/auth.ts) for an active account.
 * Tests can set DEV_AUTH_BYPASS=1 to act as the dev owner (or X-Dev-User); it never works outside development.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  assertSameOrigin(c);
  let row: UserRow | null = null;
  let sessionId: string | null = null;
  const s = await currentSession(c, 'admin');
  if (s) {
    row = await first<UserRow>(c.env.DB, `${USER_SQL} u.id = ?`, s.subject_id);
    sessionId = s.id;
  } else if (c.env.DEV_AUTH_BYPASS === '1' && c.env.ENVIRONMENT === 'development' && c.env.DEV_ADMIN_EMAIL) {
    const email = (c.req.header('X-Dev-User') ?? c.env.DEV_ADMIN_EMAIL).toLowerCase();
    if (email === 'none') throw new HttpError(401, 'unauthenticated', 'Please sign in');
    row = await first<UserRow>(c.env.DB, `${USER_SQL} u.email = ?`, email);
    if (!row && email === c.env.DEV_ADMIN_EMAIL.toLowerCase()) {
      await c.env.DB.prepare("INSERT INTO users (id, email, name, role_id, status) VALUES ('usr_owner', ?, 'Owner', 'owner', 'active')").bind(email).run();
      row = await first<UserRow>(c.env.DB, `${USER_SQL} u.email = ?`, email);
    }
  }
  if (!row) throw new HttpError(401, 'unauthenticated', 'Please sign in');
  if (row.status !== 'active') throw new HttpError(401, 'unauthenticated', 'Your access has changed. Please sign in again.');

  const user: AdminUser = { id: row.id, email: row.email, name: row.name, roleId: row.role_id, permissions: new Set(JSON.parse(row.permissions) as Permission[]) };
  c.set('user', user);
  c.set('sessionId', sessionId);
  c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), user.id).run());
  await next();
});

export const can = (...perms: Permission[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const u = c.get('user');
    if (!perms.every((p) => u.permissions.has(p))) throw forbidden();
    await next();
  });

/** Shopper routes: a live shopper session for an account that isn't disabled. */
export const requireCustomer = createMiddleware<AppEnv>(async (c, next) => {
  assertSameOrigin(c);
  const s = await currentSession(c, 'customer');
  const row = s ? await first<{ id: string; email: string; name: string; phone: string; disabled: number }>(c.env.DB, 'SELECT id, email, name, phone, disabled FROM customers WHERE id = ?', s.subject_id) : null;
  if (!row || row.disabled) throw new HttpError(401, 'unauthenticated', 'Please sign in');
  c.set('customer', { id: row.id, email: row.email, name: row.name, phone: row.phone });
  c.set('sessionId', s!.id);
  await next();
});

/** The signed-in shopper, if any (checkout and quotes work for guests too). */
export async function optionalCustomer(c: Parameters<typeof requireCustomer>[0]) {
  const s = await currentSession(c, 'customer');
  if (!s) return null;
  return first<{ id: string; email: string; name: string; phone: string }>(c.env.DB, 'SELECT id, email, name, phone FROM customers WHERE id = ? AND disabled = 0', s.subject_id);
}

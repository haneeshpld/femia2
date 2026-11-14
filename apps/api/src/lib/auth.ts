import { createMiddleware } from 'hono/factory';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { Permission } from '@femia/contracts';
import type { AdminUser, AppEnv, Env } from '../env.ts';
import { forbidden, HttpError } from './http.ts';
import { first } from './db.ts';

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

async function emailFromAccess(req: Request, env: Env): Promise<string | null> {
  const jwt = req.headers.get('Cf-Access-Jwt-Assertion');
  if (!jwt || !env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) return null;
  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}`;
  let jwks = jwksCache.get(issuer);
  if (!jwks) { jwks = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`)); jwksCache.set(issuer, jwks); }
  try {
    const { payload } = await jwtVerify(jwt, jwks, { issuer, audience: env.ACCESS_AUD });
    return typeof payload.email === 'string' ? payload.email.toLowerCase() : null;
  } catch {
    return null;
  }
}

/** Cloudflare Access in front; we verify the JWT and map email → user → role permissions. */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  let email = await emailFromAccess(c.req.raw, c.env);
  if (!email && c.env.ENVIRONMENT === 'development' && c.env.DEV_ADMIN_EMAIL) {
    email = (c.req.header('X-Dev-User') ?? c.env.DEV_ADMIN_EMAIL).toLowerCase();
  }
  if (!email) throw new HttpError(401, 'unauthenticated', 'Please sign in again');

  let row = await first<{ id: string; email: string; name: string; role_id: string; permissions: string; active: number }>(
    c.env.DB,
    'SELECT u.id, u.email, u.name, u.role_id, r.permissions, u.active FROM users u JOIN roles r ON r.id = u.role_id WHERE u.email = ?',
    email,
  );
  // First login bootstraps the owner in development only.
  if (!row && c.env.ENVIRONMENT === 'development' && email === c.env.DEV_ADMIN_EMAIL?.toLowerCase()) {
    await c.env.DB.prepare("INSERT INTO users (id, email, name, role_id) VALUES ('usr_owner', ?, 'Owner', 'owner')").bind(email).run();
    row = { id: 'usr_owner', email, name: 'Owner', role_id: 'owner', permissions: (await first<{ permissions: string }>(c.env.DB, "SELECT permissions FROM roles WHERE id='owner'"))!.permissions, active: 1 };
  }
  if (!row || !row.active) throw forbidden('Your account does not have access to Femia Admin');

  const user: AdminUser = { id: row.id, email: row.email, name: row.name, roleId: row.role_id, permissions: new Set(JSON.parse(row.permissions) as Permission[]) };
  c.set('user', user);
  c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').bind(new Date().toISOString(), user.id).run());
  await next();
});

export const can = (...perms: Permission[]) =>
  createMiddleware<AppEnv>(async (c, next) => {
    const u = c.get('user');
    if (!perms.every((p) => u.permissions.has(p))) throw forbidden();
    await next();
  });

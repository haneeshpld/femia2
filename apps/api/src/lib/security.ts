import type { Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Env } from '../env.ts';
import { hmacSha256Hex, safeEqual } from './crypto.ts';
import { HttpError } from './http.ts';

const enc = new TextEncoder();
const hex = (b: ArrayBuffer | Uint8Array) => Array.from(b instanceof Uint8Array ? b : new Uint8Array(b), (x) => x.toString(16).padStart(2, '0')).join('');
const b64url = (u: Uint8Array) => btoa(String.fromCharCode(...u)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));

export const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));
export async function sha256Hex(s: string) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(s))); }

/** Server secret used to pepper passwords and sign short-lived tokens. Required outside development. */
export function serverSecret(env: Env): string {
  if (env.SECRETS_KEY) return env.SECRETS_KEY;
  if (env.ENVIRONMENT === 'development') return 'dev-only-secret-do-not-use-in-production';
  throw new HttpError(500, 'misconfigured', 'Sign-in is not configured');
}

// ───────── passwords: PBKDF2-SHA256, per-user salt, server pepper ─────────
const ITER = 100_000; // the Workers runtime ceiling for PBKDF2
async function derive(env: Env, password: string, salt: Uint8Array, iter: number) {
  const peppered = await hmacSha256Hex(serverSecret(env), password.normalize('NFKC'));
  const key = await crypto.subtle.importKey('raw', enc.encode(peppered), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
export async function hashPassword(env: Env, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return `pbkdf2$${ITER}$${b64url(salt)}$${await derive(env, password, salt, ITER)}`;
}
export async function verifyPassword(env: Env, password: string, stored: string | null): Promise<boolean> {
  // Always do the work, so a missing account takes as long as a wrong password.
  const [, iterS, saltS, want] = (stored ?? `pbkdf2$${ITER}$AAAAAAAAAAAAAAAAAAAAAA$x`).split('$');
  const got = await derive(env, password, unb64url(saltS ?? ''), Number(iterS) || ITER);
  return !!stored && !!want && safeEqual(got, want);
}

// ───────── short-lived signed tokens (sign-up and login challenges) ─────────
export async function signToken(env: Env, purpose: string, data: Record<string, unknown>, ttlSec: number) {
  const body = b64url(enc.encode(JSON.stringify({ ...data, p: purpose, exp: Math.floor(Date.now() / 1000) + ttlSec })));
  return `${body}.${await hmacSha256Hex(serverSecret(env), `${purpose}.${body}`)}`;
}
export async function readToken<T extends Record<string, unknown>>(env: Env, purpose: string, token: string): Promise<T | null> {
  const [body, sig] = token.split('.');
  if (!body || !sig || !safeEqual(sig, await hmacSha256Hex(serverSecret(env), `${purpose}.${body}`))) return null;
  try {
    const d = JSON.parse(new TextDecoder().decode(unb64url(body))) as T & { p: string; exp: number };
    return d.p === purpose && d.exp > Date.now() / 1000 ? d : null;
  } catch { return null; }
}

// ───────── rate limits (fixed windows in D1) ─────────
export async function rateLimit(db: D1Database, key: string, limit: number, windowSec: number, message = 'Too many attempts. Please wait a little and try again.') {
  const now = Math.floor(Date.now() / 1000);
  const row = await db.prepare(`INSERT INTO rate_limits (key, count, reset_at) VALUES (?1, 1, ?2)
    ON CONFLICT(key) DO UPDATE SET count = CASE WHEN reset_at <= ?3 THEN 1 ELSE count + 1 END,
                                   reset_at = CASE WHEN reset_at <= ?3 THEN ?2 ELSE reset_at END
    RETURNING count, reset_at`).bind(key, now + windowSec, now).first<{ count: number; reset_at: number }>();
  if (row && row.count > limit) throw new HttpError(429, 'rate_limited', message, { retryAfter: row.reset_at - now });
}

export const clientIp = (c: Context) => c.req.header('cf-connecting-ip') ?? c.req.header('x-real-ip') ?? 'local';
export const userAgent = (c: Context) => (c.req.header('user-agent') ?? '').slice(0, 200);

// ───────── cookies ─────────
export type SessionKind = 'customer' | 'admin';
const secureEnv = (env: Env) => env.ENVIRONMENT !== 'development';
export const cookieName = (env: Env, kind: SessionKind) => `${secureEnv(env) ? '__Host-' : ''}femia_${kind === 'admin' ? 'a' : 'c'}`;
export function writeSessionCookie(c: Context<AppEnv>, kind: SessionKind, token: string, maxAgeSec: number) {
  setCookie(c, cookieName(c.env, kind), token, {
    path: '/', httpOnly: true, secure: secureEnv(c.env), sameSite: kind === 'admin' ? 'Strict' : 'Lax', maxAge: maxAgeSec,
  });
}
export const readSessionCookie = (c: Context<AppEnv>, kind: SessionKind) => getCookie(c, cookieName(c.env, kind)) ?? null;
export function clearSessionCookie(c: Context<AppEnv>, kind: SessionKind) {
  deleteCookie(c, cookieName(c.env, kind), { path: '/', secure: secureEnv(c.env) });
}

/**
 * Cross-site request guard for cookie-authenticated writes: browsers always send Origin on POST/PUT/PATCH/DELETE,
 * so a mismatching Origin is a forged request. (No Origin = not a browser, which can't carry the victim's cookies.)
 */
export function assertSameOrigin(c: Context<AppEnv>) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) return;
  const origin = c.req.header('origin');
  if (!origin) return;
  const allowed = [c.env.PUBLIC_SITE_URL, c.env.ADMIN_URL].filter(Boolean).map((u) => { try { return new URL(u).origin; } catch { return ''; } });
  if (!allowed.includes(origin)) throw new HttpError(403, 'bad_origin', 'This request was blocked for your safety. Please reload the page and try again.');
}

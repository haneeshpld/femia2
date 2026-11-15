import type { Context } from 'hono';
import type { AppEnv, Env } from '../env.ts';
import { first, nowIso } from '../lib/db.ts';
import { clearSessionCookie, clientIp, randomToken, readSessionCookie, sha256Hex, userAgent, writeSessionCookie, type SessionKind } from '../lib/security.ts';

/**
 * Server-side sessions. The browser holds a random 256-bit token in an HttpOnly cookie; the database keeps only
 * its SHA-256, so a leaked database can't be replayed. Admin: signed out after 12 h idle, 7 days at most.
 * Shoppers: 30 days idle, 90 days at most. Revoked on sign-out, password change or by an admin.
 */
const H = 3600e3;
export const SESSION_TTL: Record<SessionKind, { idle: number; max: number }> = {
  admin: { idle: 12 * H, max: 7 * 24 * H },
  customer: { idle: 30 * 24 * H, max: 90 * 24 * H },
};

type C = Context<AppEnv>;
export interface SessionRow { id: string; kind: SessionKind; subject_id: string; created_at: string; last_seen_at: string; expires_at: string; ip: string; user_agent: string }

export async function startSession(c: C, kind: SessionKind, subjectId: string) {
  const token = randomToken(32);
  const now = Date.now();
  await c.env.DB.prepare('INSERT INTO sessions (id, kind, subject_id, created_at, last_seen_at, expires_at, ip, user_agent) VALUES (?,?,?,?,?,?,?,?)')
    .bind(await sha256Hex(token), kind, subjectId, new Date(now).toISOString(), new Date(now).toISOString(), new Date(now + SESSION_TTL[kind].max).toISOString(), clientIp(c), userAgent(c)).run();
  writeSessionCookie(c, kind, token, Math.floor(SESSION_TTL[kind].max / 1000));
}

export async function currentSession(c: C, kind: SessionKind): Promise<SessionRow | null> {
  const token = readSessionCookie(c, kind);
  if (!token || token.length < 30 || token.length > 100) return null;
  const s = await first<SessionRow>(c.env.DB, 'SELECT * FROM sessions WHERE id = ? AND kind = ? AND revoked_at IS NULL', await sha256Hex(token), kind);
  const now = Date.now();
  if (!s || Date.parse(s.expires_at) <= now || now - Date.parse(s.last_seen_at) > SESSION_TTL[kind].idle) return null;
  if (now - Date.parse(s.last_seen_at) > 5 * 60e3) {
    c.executionCtx.waitUntil(c.env.DB.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').bind(new Date(now).toISOString(), s.id).run());
  }
  return s;
}

export async function endSession(c: C, kind: SessionKind) {
  const token = readSessionCookie(c, kind);
  if (token) await c.env.DB.prepare('UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').bind(nowIso(), await sha256Hex(token)).run();
  clearSessionCookie(c, kind);
}

export const revokeAllStatement = (db: D1Database, kind: SessionKind, subjectId: string, exceptId?: string) =>
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE kind = ? AND subject_id = ? AND revoked_at IS NULL AND id != ?').bind(nowIso(), kind, subjectId, exceptId ?? '');

/** Browser and city-free device label for the "where you're signed in" list. */
export function deviceLabel(ua: string) {
  const os = /iPhone|iPad/.test(ua) ? 'iPhone' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'Device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}

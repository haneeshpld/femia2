import type { Env } from '../env.ts';
import { hmacSha256Hex, safeEqual } from '../lib/crypto.ts';
import { first, nowIso } from '../lib/db.ts';
import { HttpError } from '../lib/http.ts';
import { rateLimit, serverSecret } from '../lib/security.ts';
import { sendEmail } from '../notify/index.ts';

/**
 * One-time 6-digit codes, emailed through Resend. Codes are stored only as an HMAC, expire after 10 minutes,
 * allow 5 tries, and asking for a new one cancels the old one.
 *
 * Until Resend is set up: in development the code is always 123456 (or FIXED_OTP_CODE). In production a fixed
 * code is only allowed for the Admin team and only if the owner sets the FIXED_OTP_CODE secret; shopper sign-in
 * stays closed until real emails can be sent, so nobody can sign in to a shopper's account with a known code.
 */
export type CodePurpose = 'customer' | 'admin_signup' | 'admin_login' | 'admin_reset';
const TTL_MIN = 10, MAX_TRIES = 5;

export type Delivery = { mode: 'email' } | { mode: 'fixed'; code: string; reveal: boolean };
export function codeDelivery(env: Env, purpose: CodePurpose): Delivery {
  if (env.RESEND_API_KEY) return { mode: 'email' };
  if (env.ENVIRONMENT === 'development') return { mode: 'fixed', code: env.FIXED_OTP_CODE || '123456', reveal: true };
  // A fixed code you choose (FIXED_OTP_CODE). Staging (a test site): everything. Production: only as the second
  // step of Admin sign-in and sign-up, where a password (or an admin's approval) is still needed. Everyone on the
  // team knows the code, so it must never be enough on its own: it can't reset a password (that would let anyone
  // who knows it take over the owner's account) and it can't sign a shopper in.
  if (env.FIXED_OTP_CODE && /^\d{6}$/.test(env.FIXED_OTP_CODE)
    && (env.ENVIRONMENT === 'staging' || purpose === 'admin_login' || purpose === 'admin_signup')) return { mode: 'fixed', code: env.FIXED_OTP_CODE, reveal: false };
  throw new HttpError(503, 'codes_unavailable', purpose === 'customer'
    ? 'Signing in by email is not available just yet. You can still check out as a guest.'
    : purpose === 'admin_reset' && env.FIXED_OTP_CODE
      ? 'Passwords can be reset once email codes are set up (add the Resend key to the API). Until then, ask the owner.'
      : 'Email codes are not set up yet. Add the Resend key (or a temporary FIXED_OTP_CODE secret) to the API.');
}

function sixDigits() {
  const buf = new Uint32Array(1);
  for (;;) { crypto.getRandomValues(buf); if (buf[0]! < 4_294_000_000) return String(buf[0]! % 1_000_000).padStart(6, '0'); }
}
const hashCode = (env: Env, purpose: string, email: string, code: string) => hmacSha256Hex(serverSecret(env), `otp:${purpose}:${email}:${code}`);

const COPY: Record<CodePurpose, { subject: string; title: string; body: string }> = {
  customer: { subject: 'Your Femia sign-in code', title: 'Your sign-in code', body: 'Use this code to sign in to your Femia account.' },
  admin_signup: { subject: 'Verify your email for Femia Admin', title: 'Verify your email', body: 'Use this code to finish creating your Femia Admin account.' },
  admin_login: { subject: 'Your Femia Admin sign-in code', title: 'Your sign-in code', body: 'Someone, hopefully you, entered your password for Femia Admin. Use this code to finish signing in.' },
  admin_reset: { subject: 'Reset your Femia Admin password', title: 'Reset your password', body: 'Use this code to set a new password for Femia Admin.' },
};
function codeEmail(purpose: CodePurpose, code: string) {
  const c = COPY[purpose];
  const html = `<!doctype html><html><body style="margin:0;background:#FBF1E9;font-family:Georgia,'Times New Roman',serif;color:#4A3329">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFDFA;border-radius:14px;overflow:hidden">
<tr><td style="background:#7A1628;height:6px;border-bottom:2px solid #C79A3E"></td></tr>
<tr><td style="padding:32px 32px 8px;text-align:center">
<p style="margin:0 0 4px;font-style:italic;font-size:28px;color:#7A1628">Femia</p>
<h1 style="margin:16px 0 8px;font-weight:400;font-size:24px;color:#3A1F14">${c.title}</h1>
<p style="margin:0;font-family:Arial,sans-serif;font-size:15px;line-height:1.5;color:#6E5A50">${c.body}</p>
<p style="margin:24px 0 8px;font-family:'Courier New',monospace;font-size:36px;letter-spacing:10px;font-weight:700;color:#3A1F14">${code}</p>
<p style="margin:0 0 24px;font-family:Arial,sans-serif;font-size:13px;color:#6E5A50">It expires in ${TTL_MIN} minutes. Never share it with anyone, including Femia staff.</p>
</td></tr>
<tr><td style="padding:16px 32px 28px;font-family:Arial,sans-serif;font-size:12px;color:#8A766C;text-align:center;border-top:1px solid #E9D9CF">If you didn't ask for this, you can ignore this email. Your account is safe.</td></tr>
</table></td></tr></table></body></html>`;
  const text = `${c.title}\n\n${c.body}\n\n${code}\n\nIt expires in ${TTL_MIN} minutes. Never share it with anyone.\nIf you didn't ask for this, ignore this email.`;
  return { subject: c.subject, html, text };
}

/** Send a fresh code. Returns how it was delivered (the dev code is revealed only in development). */
export async function issueCode(env: Env, ctx: { waitUntil(p: Promise<unknown>): void }, purpose: CodePurpose, email: string, ip: string) {
  const delivery = codeDelivery(env, purpose);
  // Asked again within 30 seconds (went back, double-tapped)? Keep the code we just sent instead of refusing.
  const recent = await first<{ created_at: string; expires_at: string }>(env.DB,
    'SELECT created_at, expires_at FROM otp_codes WHERE purpose = ? AND email = ? AND consumed_at IS NULL AND attempts < ? ORDER BY id DESC LIMIT 1', purpose, email, MAX_TRIES);
  const age = recent ? (Date.now() - Date.parse(recent.created_at)) / 1000 : Infinity;
  if (recent && age < 30 && Date.parse(recent.expires_at) > Date.now()) {
    return { delivery: delivery.mode, devCode: delivery.mode === 'fixed' && delivery.reveal ? delivery.code : undefined, resendIn: Math.ceil(30 - age), expiresIn: Math.floor((Date.parse(recent.expires_at) - Date.now()) / 1000), reused: true };
  }
  // Counted per kind of code: anyone can ask for a shopper code for any email, and that must not use up the
  // codes an admin with the same email needs to sign in (it would lock them out of Admin for as long as it's kept up).
  await rateLimit(env.DB, `otp:hour:${purpose}:${email}`, 8, 3600, 'Too many codes for this email. Please try again in an hour.');
  await rateLimit(env.DB, `otp:ip:${ip}`, 30, 3600);
  const code = delivery.mode === 'fixed' ? delivery.code : sixDigits();
  const now = nowIso();
  await env.DB.batch([
    env.DB.prepare('UPDATE otp_codes SET consumed_at = ? WHERE purpose = ? AND email = ? AND consumed_at IS NULL').bind(now, purpose, email),
    env.DB.prepare('INSERT INTO otp_codes (purpose, email, code_hash, expires_at, created_at) VALUES (?,?,?,?,?)')
      .bind(purpose, email, await hashCode(env, purpose, email, code), new Date(Date.now() + TTL_MIN * 60e3).toISOString(), now),
  ]);
  if (delivery.mode === 'email') ctx.waitUntil(sendEmail(env, { to: email, ...codeEmail(purpose, code) }));
  return { delivery: delivery.mode, devCode: delivery.mode === 'fixed' && delivery.reveal ? code : undefined, resendIn: 30, expiresIn: TTL_MIN * 60 };
}

/** Check a code once. Wrong tries count down; the code can't be used twice. */
export async function verifyCode(env: Env, purpose: CodePurpose, email: string, code: string, ip: string) {
  await rateLimit(env.DB, `otp:verify:${ip}`, 60, 3600);
  const row = await first<{ id: number; code_hash: string; attempts: number; expires_at: string }>(env.DB,
    'SELECT id, code_hash, attempts, expires_at FROM otp_codes WHERE purpose = ? AND email = ? AND consumed_at IS NULL ORDER BY id DESC LIMIT 1', purpose, email);
  if (!row || Date.parse(row.expires_at) <= Date.now()) throw new HttpError(400, 'code_expired', 'This code has expired. Ask for a new one.');
  // Use up a try *before* checking, in one statement: many guesses sent at once can't all slip in under the limit.
  const took = await env.DB.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ? AND attempts < ? AND consumed_at IS NULL RETURNING attempts')
    .bind(row.id, MAX_TRIES).first<{ attempts: number }>();
  if (!took) throw new HttpError(400, 'code_locked', 'Too many wrong tries. Ask for a new code.');
  if (!safeEqual(await hashCode(env, purpose, email, code), row.code_hash)) {
    const left = MAX_TRIES - took.attempts;
    throw new HttpError(400, left > 0 ? 'code_wrong' : 'code_locked', left > 0 ? `That code isn't right. ${left} ${left === 1 ? 'try' : 'tries'} left.` : 'Too many wrong tries. Ask for a new code.');
  }
  const used = await env.DB.prepare('UPDATE otp_codes SET consumed_at = ? WHERE id = ? AND consumed_at IS NULL').bind(nowIso(), row.id).run();
  if (!used.meta.changes) throw new HttpError(400, 'code_expired', 'This code was already used. Ask for a new one.');
}

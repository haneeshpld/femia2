import { Hono } from 'hono';
import { AdminLogin, AdminLoginVerify, AdminReset, AdminSignup, CodeVerify, CustomerRegister, EmailStart } from '@femia/contracts';
import { z } from 'zod';
import type { AppEnv, Env } from '../env.ts';
import { audit, first, newId, nowIso, all } from '../lib/db.ts';
import { HttpError, readJson } from '../lib/http.ts';
import { assertSameOrigin, clientIp, hashPassword, rateLimit, readToken, signToken, verifyPassword } from '../lib/security.ts';
import { sendEmail, sendTelegram } from '../notify/index.ts';
import { claimGuestOrdersStatements, createCustomer, customerByEmail, toProfile } from '../services/customers.ts';
import { issueCode, verifyCode } from '../services/otp.ts';
import { endSession, revokeAllStatement, startSession } from '../services/sessions.ts';

export const authRoutes = new Hono<AppEnv>();
authRoutes.use('*', async (c, next) => { assertSameOrigin(c); await next(); });

// ═════════════ shoppers: email → 6-digit code → (new accounts) name & mobile ═════════════

authRoutes.post('/customer/start', async (c) => {
  const { email } = await readJson(c, EmailStart);
  // Same answer whether or not the email has an account.
  return c.json({ sent: true, email, ...(await issueCode(c.env, c.executionCtx, 'customer', email, clientIp(c))) });
});

authRoutes.post('/customer/verify', async (c) => {
  const { email, code } = await readJson(c, CodeVerify);
  await verifyCode(c.env, 'customer', email, code, clientIp(c));
  const existing = await customerByEmail(c.env.DB, email);
  if (existing) {
    if (existing.disabled) throw new HttpError(403, 'disabled', 'This account is closed. Please contact us on WhatsApp.');
    await c.env.DB.batch([
      c.env.DB.prepare('UPDATE customers SET last_login_at = ? WHERE id = ?').bind(nowIso(), existing.id),
      ...claimGuestOrdersStatements(c.env.DB, existing.id, email),
    ]);
    await startSession(c, 'customer', existing.id);
    return c.json({ status: 'signed-in', customer: toProfile(existing) });
  }
  // Email proven: let them finish the account within 20 minutes.
  return c.json({ status: 'new', email, signupToken: await signToken(c.env, 'customer-signup', { email }, 20 * 60) });
});

authRoutes.post('/customer/register', async (c) => {
  const v = await readJson(c, CustomerRegister);
  await rateLimit(c.env.DB, `register:${clientIp(c)}`, 10, 3600);
  const t = await readToken<{ email: string }>(c.env, 'customer-signup', v.signupToken);
  if (!t) throw new HttpError(400, 'signup_expired', 'That took a while. Please enter your email again to get a new code.');
  const customer = (await customerByEmail(c.env.DB, t.email)) ?? (await createCustomer(c.env.DB, { email: t.email, name: v.name, phone: v.phone, marketing: v.marketing }));
  await startSession(c, 'customer', customer.id);
  return c.json({ status: 'signed-in', customer: toProfile(customer) }, 201);
});

authRoutes.post('/customer/sign-out', async (c) => { await endSession(c, 'customer'); return c.json({ ok: true }); });

// ═════════════ Admin team: password + emailed code; new sign-ups wait for another admin's approval ═════════════

const ownerEmail = (env: Env) => (env.OWNER_EMAIL || (env.ENVIRONMENT === 'development' ? env.DEV_ADMIN_EMAIL : '') || '').trim().toLowerCase();
type UserRow = { id: string; email: string; name: string; role_id: string; status: string; password_hash: string | null; failed_logins: number; locked_until: string | null };

authRoutes.post('/admin/signup', async (c) => {
  const v = await readJson(c, AdminSignup);
  await rateLimit(c.env.DB, `adm-signup:${clientIp(c)}`, 10, 3600);
  await c.env.DB.prepare(`INSERT INTO admin_signups (email, name, password_hash, created_at) VALUES (?,?,?,?)
    ON CONFLICT(email) DO UPDATE SET name = excluded.name, password_hash = excluded.password_hash, created_at = excluded.created_at`)
    .bind(v.email, v.name, await hashPassword(c.env, v.password), nowIso()).run();
  return c.json({ sent: true, email: v.email, ...(await issueCode(c.env, c.executionCtx, 'admin_signup', v.email, clientIp(c))) });
});

authRoutes.post('/admin/signup/verify', async (c) => {
  const { email, code } = await readJson(c, CodeVerify);
  await verifyCode(c.env, 'admin_signup', email, code, clientIp(c));
  const pending = await first<{ name: string; password_hash: string; created_at: string }>(c.env.DB, 'SELECT name, password_hash, created_at FROM admin_signups WHERE email = ?', email);
  if (!pending || Date.now() - Date.parse(pending.created_at) > 60 * 60e3) throw new HttpError(400, 'signup_expired', 'Please start again: fill in the form and we’ll send a new code.');
  const user = await first<UserRow>(c.env.DB, 'SELECT * FROM users WHERE email = ?', email);
  const now = nowIso();
  const done = c.env.DB.prepare('DELETE FROM admin_signups WHERE email = ?').bind(email);

  if (user?.password_hash) { await done.run(); throw new HttpError(409, 'already_registered', 'This email already has an account. Please sign in.'); }
  if (user && (user.status === 'rejected' || user.status === 'disabled')) { await done.run(); throw new HttpError(403, 'no_access', 'This email can’t be used for Femia Admin. Please ask the owner.'); }

  if (user) {
    // Invited by an admin (already approved), or set up before passwords existed: finish and sign in.
    await c.env.DB.batch([
      c.env.DB.prepare(`UPDATE users SET password_hash = ?, name = CASE WHEN name = '' THEN ? ELSE name END, status = 'active', active = 1,
        email_verified_at = ?, password_changed_at = ?, last_login_at = ?, approved_at = COALESCE(approved_at, ?) WHERE id = ?`)
        .bind(pending.password_hash, pending.name, now, now, now, now, user.id),
      done,
      audit(c.env.DB, email, 'auth.signup', 'user', user.id, 'Created a password (invited)'),
    ]);
    await startSession(c, 'admin', user.id);
    return c.json({ status: 'active' });
  }

  const isOwner = !!ownerEmail(c.env) && email === ownerEmail(c.env)
    && !(await first(c.env.DB, "SELECT 1 FROM users WHERE role_id = 'owner' AND status = 'active' AND password_hash IS NOT NULL"));
  const id = newId('usr');
  await c.env.DB.batch([
    c.env.DB.prepare(`INSERT INTO users (id, email, name, role_id, active, status, password_hash, email_verified_at, password_changed_at, approved_at, last_login_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?)`).bind(id, email, pending.name, isOwner ? 'owner' : 'staff', isOwner ? 1 : 0, isOwner ? 'active' : 'pending',
      pending.password_hash, now, now, isOwner ? now : null, isOwner ? now : null),
    done,
    audit(c.env.DB, email, isOwner ? 'auth.owner_created' : 'auth.signup', 'user', id, isOwner ? 'Owner account created' : 'Signed up, waiting for approval'),
  ]);
  if (isOwner) { await startSession(c, 'admin', id); return c.json({ status: 'active' }); }
  c.executionCtx.waitUntil(tellApprovers(c.env, pending.name, email));
  return c.json({ status: 'pending' }, 201);
});

async function tellApprovers(env: Env, name: string, email: string) {
  const admins = await all<{ email: string }>(env.DB, `SELECT u.email FROM users u JOIN roles r ON r.id = u.role_id
    WHERE u.status = 'active' AND r.permissions LIKE '%people.manage%'`);
  const link = `${env.ADMIN_URL}/people`;
  await sendTelegram(env, `🔐 <b>${name}</b> (${email}) asked for access to Femia Admin. Approve or decline in People: ${link}`);
  if (env.RESEND_API_KEY) {
    for (const a of admins) await sendEmail(env, { to: a.email, subject: `${name} asked for access to Femia Admin`,
      html: `<p>${name} (${email}) signed up for Femia Admin and is waiting for approval.</p><p><a href="${link}">Review in People</a></p><p>If you don't know this person, decline the request.</p>`,
      text: `${name} (${email}) signed up for Femia Admin and is waiting for approval. Review: ${link}` });
  }
}

const BAD = () => new HttpError(401, 'bad_credentials', 'That email and password don’t match.');

authRoutes.post('/admin/login', async (c) => {
  const { email, password } = await readJson(c, AdminLogin);
  await rateLimit(c.env.DB, `adm-login:ip:${clientIp(c)}`, 30, 3600);
  await rateLimit(c.env.DB, `adm-login:em:${email}`, 20, 3600);
  const user = await first<UserRow>(c.env.DB, 'SELECT * FROM users WHERE email = ?', email);
  if (user?.locked_until && Date.parse(user.locked_until) > Date.now()) {
    const mins = Math.ceil((Date.parse(user.locked_until) - Date.now()) / 60e3);
    throw new HttpError(429, 'locked', `Too many wrong passwords. Try again in ${mins} minute${mins === 1 ? '' : 's'}, or reset your password.`);
  }
  const ok = await verifyPassword(c.env, password, user?.password_hash ?? null);
  if (!user || !ok) {
    if (user) {
      const fails = user.failed_logins + 1;
      await c.env.DB.batch([
        fails >= 5
          ? c.env.DB.prepare('UPDATE users SET failed_logins = 0, locked_until = ? WHERE id = ?').bind(new Date(Date.now() + 15 * 60e3).toISOString(), user.id)
          : c.env.DB.prepare('UPDATE users SET failed_logins = ? WHERE id = ?').bind(fails, user.id),
        audit(c.env.DB, email, 'auth.login_failed', 'user', user.id, fails >= 5 ? 'Wrong password, locked for 15 minutes' : 'Wrong password'),
      ]);
    }
    throw BAD();
  }
  if (user.failed_logins) await c.env.DB.prepare('UPDATE users SET failed_logins = 0 WHERE id = ?').bind(user.id).run();
  if (user.status === 'pending') throw new HttpError(403, 'pending_approval', 'Your account is waiting for approval. We’ll let you know once an admin approves it.');
  if (user.status !== 'active') throw new HttpError(403, 'no_access', 'This account doesn’t have access to Femia Admin. Please ask the owner.');
  const sent = await issueCode(c.env, c.executionCtx, 'admin_login', email, clientIp(c));
  return c.json({ next: 'code', email, challenge: await signToken(c.env, 'admin-login', { uid: user.id, email }, 10 * 60), ...sent });
});

authRoutes.post('/admin/login/resend', async (c) => {
  const { challenge } = await readJson(c, z.object({ challenge: z.string().min(20).max(600) }));
  const t = await readToken<{ uid: string; email: string }>(c.env, 'admin-login', challenge);
  if (!t) throw new HttpError(400, 'challenge_expired', 'Please enter your password again.');
  return c.json(await issueCode(c.env, c.executionCtx, 'admin_login', t.email, clientIp(c)));
});

authRoutes.post('/admin/login/verify', async (c) => {
  const { challenge, code } = await readJson(c, AdminLoginVerify);
  const t = await readToken<{ uid: string; email: string }>(c.env, 'admin-login', challenge);
  if (!t) throw new HttpError(400, 'challenge_expired', 'That took a while. Please enter your password again.');
  await verifyCode(c.env, 'admin_login', t.email, code, clientIp(c));
  const user = await first<UserRow>(c.env.DB, 'SELECT * FROM users WHERE id = ?', t.uid);
  if (!user || user.status !== 'active') throw new HttpError(403, 'no_access', 'This account doesn’t have access to Femia Admin.');
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), user.id),
    audit(c.env.DB, user.email, 'auth.login', 'user', user.id, 'Signed in'),
  ]);
  await startSession(c, 'admin', user.id);
  return c.json({ ok: true });
});

authRoutes.post('/admin/forgot', async (c) => {
  const { email } = await readJson(c, EmailStart);
  await rateLimit(c.env.DB, `adm-forgot:${clientIp(c)}`, 10, 3600);
  const user = await first<UserRow>(c.env.DB, "SELECT * FROM users WHERE email = ? AND status = 'active' AND password_hash IS NOT NULL", email);
  // Same answer either way, so this can't be used to find out who has an account.
  const sent = user ? await issueCode(c.env, c.executionCtx, 'admin_reset', email, clientIp(c)) : { delivery: 'email' as const, resendIn: 30, expiresIn: 600 };
  return c.json({ sent: true, email, ...sent });
});

authRoutes.post('/admin/reset', async (c) => {
  const v = await readJson(c, AdminReset);
  await verifyCode(c.env, 'admin_reset', v.email, v.code, clientIp(c));
  const user = await first<UserRow>(c.env.DB, "SELECT * FROM users WHERE email = ? AND status = 'active'", v.email);
  if (!user) throw new HttpError(403, 'no_access', 'This account doesn’t have access to Femia Admin.');
  const now = nowIso();
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET password_hash = ?, password_changed_at = ?, failed_logins = 0, locked_until = NULL WHERE id = ?').bind(await hashPassword(c.env, v.password), now, user.id),
    revokeAllStatement(c.env.DB, 'admin', user.id),
    audit(c.env.DB, user.email, 'auth.password_reset', 'user', user.id, 'Reset password; signed out everywhere'),
  ]);
  return c.json({ ok: true });
});

authRoutes.post('/admin/sign-out', async (c) => { await endSession(c, 'admin'); return c.json({ ok: true }); });
